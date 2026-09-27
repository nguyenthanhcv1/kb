/**
 * Access administration through supabase-js → PostgREST → RLS / admin_* functions / triggers
 * (T1.7a acceptance), including the middleware's `has_active_access` RPC.
 *
 * Needs `supabase start` (at least db, rest, kong):
 *   ADMIN_TEST_SUPABASE_URL=http://127.0.0.1:54321
 *   ADMIN_TEST_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long
 *   ADMIN_TEST_ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
 * Skipped when unset.
 */
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AdminError,
  addAccessEntries,
  listAccessEntries,
  listUsers,
  previewAccessRemoval,
  removeAccessEntries,
  setUserDeactivated,
  setUserSuperAdmin,
  type AdminDb,
} from "./index";

const URL = process.env.ADMIN_TEST_SUPABASE_URL;
const SECRET = process.env.ADMIN_TEST_JWT_SECRET;
const ADMIN_URL = process.env.ADMIN_TEST_ADMIN_DATABASE_URL;

const tag = randomUUID().slice(0, 8);
const internalDomain = `int-${tag}.kbtest.dev`;
const externalDomain = `ext-${tag}.kbtest.dev`;

const users = {
  super: { id: randomUUID(), email: `super@${internalDomain}` },
  internal: { id: randomUUID(), email: `internal@${internalDomain}` },
  solo: { id: randomUUID(), email: `solo@${externalDomain}` },
  guest: { id: randomUUID(), email: `guest@${externalDomain}` },
};
type Who = keyof typeof users;
const spaceId = randomUUID();

let db: pg.Client;
const as = {} as Record<Who, SupabaseClient>;
/**
 * The core module identifies the caller with `auth.getUser()` (a cookie session in the app). These
 * clients carry a bare JWT and no GoTrue session, so answer it from the fixture; every query still
 * goes through PostgREST with that user's JWT.
 */
const admin = (who: Who): AdminDb => ({
  auth: { getUser: async () => ({ data: { user: { id: users[who].id } } }) },
  from: (table) => as[who].from(table) as unknown as ReturnType<AdminDb["from"]>,
  rpc: (fn, args) => as[who].rpc(fn, args),
});

async function jwt(claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(SECRET));
}

async function clientFor(userId: string) {
  const anon = await jwt({ role: "anon" });
  const token = await jwt({ role: "authenticated", sub: userId, aud: "authenticated" });
  return createClient(URL!, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy(
    (error) => error instanceof AdminError && error.code === code,
  );
}

/** What the middleware asks on every request (`apps/web/src/lib/supabase/middleware.ts`). */
async function hasActiveAccess(who: Who) {
  const { data, error } = await as[who].rpc("has_active_access");
  expect(error).toBeNull();
  return data;
}

async function hook(email: string) {
  const { rows } = await db.query<{ result: { error?: { message: string } } }>(
    "select app.before_user_created_hook(jsonb_build_object('user', jsonb_build_object('email', $1::text))) as result",
    [email],
  );
  return rows[0]!.result.error?.message ?? "ALLOWED";
}

async function isGuest(who: Who) {
  const { rows } = await db.query<{ is_guest: boolean }>(
    "select is_guest from public.profiles where id = $1",
    [users[who].id],
  );
  return rows[0]!.is_guest;
}

describe.skipIf(!URL || !SECRET || !ADMIN_URL)("access administration through PostgREST", () => {
  beforeAll(async () => {
    db = new pg.Client({ connectionString: ADMIN_URL });
    await db.connect();
    const all = Object.values(users);
    await db.query("begin");
    await db.query(
      "insert into auth.users (id, email) select * from unnest($1::uuid[], $2::text[])",
      [all.map((u) => u.id), all.map((u) => u.email)],
    );
    await db.query("select set_config('request.jwt.claim.role', 'service_role', true)");
    await db.query(
      "update public.profiles set is_super_admin = true, is_guest = false where id = $1",
      [users.super.id],
    );
    await db.query("select set_config('request.jwt.claim.role', '', true)");
    await db.query(
      "insert into public.spaces (id, slug, name, created_by) values ($1, $2, 'Admin test', $3)",
      [spaceId, `adm-${tag}`, users.super.id],
    );
    await db.query(
      "insert into public.space_members (space_id, user_id, role, added_by) values ($1, $2, 'viewer', $3)",
      [spaceId, users.guest.id, users.super.id],
    );
    await db.query("commit");
    for (const who of Object.keys(users) as Who[]) as[who] = await clientFor(users[who].id);
  });

  afterAll(async () => {
    if (!db) return;
    await db.query("delete from public.access_allowlist where value::text like $1", [
      `%${tag}.kbtest.dev`,
    ]);
    // Triggers off (guard_last_space_admin would refuse the cascade), so delete children by hand.
    const ids = Object.values(users).map((u) => u.id);
    await db.query("begin");
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.space_members where space_id = $1", [spaceId]);
    await db.query("delete from public.spaces where id = $1", [spaceId]);
    await db.query("delete from public.profiles where id = any($1::uuid[])", [ids]);
    await db.query("delete from auth.users where id = any($1::uuid[])", [ids]);
    await db.query("commit");
    await db.end();
  });

  it("is super admin only, also when the functions are called directly", async () => {
    await expectCode(listAccessEntries(admin("internal")), "FORBIDDEN");
    await expectCode(listUsers(admin("guest")), "FORBIDDEN");
    const direct = await as.internal.rpc("admin_list_users");
    expect(direct.error?.message).toBe("FORBIDDEN");
    const insert = await as.internal
      .from("access_allowlist")
      .insert({ kind: "domain", value: `evil-${tag}.kbtest.dev` });
    expect(insert.error?.code).toBe("42501");
  });

  it("adds one email: that person may sign in, the rest of the domain stays blocked", async () => {
    expect(await hook(`new@${externalDomain}`)).toBe("AUTH_NOT_ALLOWED");
    const result = await addAccessEntries(admin("super"), {
      input: `Solo <${users.solo.email.toUpperCase()}>, new@${externalDomain}; gmail.com  bad`,
      note: "Team",
    });
    expect(result.results.map((r) => [r.value, r.status])).toEqual([
      [users.solo.email, "added"],
      [`new@${externalDomain}`, "added"],
      ["gmail.com", "publicDomainUnconfirmed"],
      [null, "invalid"],
    ]);
    expect(result.added.map((e) => [e.kind, e.value, e.note, e.userCount])).toEqual([
      ["email", `new@${externalDomain}`, "Team", 0],
      ["email", users.solo.email, "Team", 1],
    ]);
    expect(result.matchedUsers).toBe(1);

    expect(await hook(`new@${externalDomain}`)).toBe("ALLOWED");
    expect(await hook(`other@${externalDomain}`)).toBe("AUTH_NOT_ALLOWED");
    expect(await isGuest("solo")).toBe(false);
    expect(await isGuest("guest")).toBe(true);

    const again = await addAccessEntries(admin("super"), { input: [users.solo.email] });
    expect(again.results[0]?.status).toBe("exists");
  });

  it("adds a domain: the whole domain may sign in", async () => {
    expect(await hook(`anyone@${internalDomain}`)).toBe("AUTH_NOT_ALLOWED");
    const result = await addAccessEntries(admin("super"), { input: `@${internalDomain}` });
    expect(result.results[0]).toMatchObject({ kind: "domain", status: "added" });
    // super (already super admin) + internal, both registered users of that domain.
    expect(result.matchedUsers).toBe(2);
    expect(await hook(`anyone@${internalDomain}`)).toBe("ALLOWED");
    expect(await isGuest("internal")).toBe(false);
    expect(await hasActiveAccess("internal")).toBe(true);

    const { entries } = await listAccessEntries(admin("super"));
    const domain = entries.find((e) => e.value === internalDomain);
    expect(domain).toMatchObject({ kind: "domain", userCount: 2, isSelf: false });
  });

  it("removing an entry signs out whoever loses access on the next request", async () => {
    const { entries } = await listAccessEntries(admin("super"));
    const domain = entries.find((e) => e.value === internalDomain)!;
    await expect(previewAccessRemoval(admin("super"), { ids: [domain.id] })).resolves.toEqual({
      matchedUsers: 2,
      losingAccess: 1,
      becomingGuest: 0,
    });
    await expect(removeAccessEntries(admin("super"), { ids: [domain.id] })).resolves.toEqual({
      removed: 1,
      impact: { matchedUsers: 2, losingAccess: 1, becomingGuest: 0 },
    });
    expect(await hasActiveAccess("internal")).toBe(false);
    expect(await isGuest("internal")).toBe(true);
    expect(await hasActiveAccess("super")).toBe(true);
    expect(await hasActiveAccess("guest")).toBe(true);
    await expectCode(
      removeAccessEntries(admin("super"), { ids: [domain.id] }),
      "ACCESS_ENTRY_NOT_FOUND",
    );
  });

  it("cannot remove your own email entry", async () => {
    const { added } = await addAccessEntries(admin("super"), { input: users.super.email });
    expect(added[0]?.isSelf).toBe(true);
    await expectCode(
      removeAccessEntries(admin("super"), { ids: [added[0]!.id] }),
      "ACCESS_CANNOT_REMOVE_SELF",
    );
    const direct = await as.super
      .from("access_allowlist")
      .delete()
      .eq("id", added[0]!.id)
      .select("id");
    expect(direct.data).toEqual([]);
  });

  it("lists users with why they can sign in", async () => {
    const { users: list, total } = await listUsers(admin("super"), { query: tag });
    expect(total).toBe(4);
    expect(list.map((u) => [u.email, u.access, u.isGuest, u.spaceCount, u.isSelf])).toEqual([
      [users.guest.email, "membership", true, 1, false],
      [users.internal.email, "none", true, 0, false],
      [users.solo.email, "allowlist", false, 0, false],
      [users.super.email, "super_admin", false, 1, true],
    ]);
    const page = await listUsers(admin("super"), { query: externalDomain, limit: 1, offset: 1 });
    expect(page).toMatchObject({ total: 2, users: [{ email: users.solo.email }] });
  });

  it("locks and unlocks a user", async () => {
    const locked = await setUserDeactivated(admin("super"), {
      userId: users.solo.id,
      deactivated: true,
    });
    expect(locked).toMatchObject({ access: "deactivated" });
    expect(locked.deactivatedAt).not.toBeNull();
    expect(await hasActiveAccess("solo")).toBe(false);

    const unlocked = await setUserDeactivated(admin("super"), {
      userId: users.solo.id,
      deactivated: false,
    });
    expect(unlocked).toMatchObject({ access: "allowlist", deactivatedAt: null });
    expect(await hasActiveAccess("solo")).toBe(true);
  });

  it("grants and revokes super admin, with the self/guest rules", async () => {
    await expectCode(
      setUserSuperAdmin(admin("super"), { userId: users.guest.id, superAdmin: true }),
      "USER_IS_GUEST",
    );
    await expectCode(
      setUserSuperAdmin(admin("super"), { userId: users.super.id, superAdmin: false }),
      "USER_CANNOT_CHANGE_SELF",
    );
    const direct = await as.super.rpc("admin_set_super_admin", {
      p_user_id: users.super.id,
      p_is_super_admin: false,
    });
    expect(direct.error?.message).toBe("USER_CANNOT_CHANGE_SELF");
    const selfLock = await as.super.rpc("admin_set_user_deactivated", {
      p_user_id: users.super.id,
      p_deactivated: true,
    });
    expect(selfLock.error?.message).toBe("USER_CANNOT_CHANGE_SELF");

    const granted = await setUserSuperAdmin(admin("super"), {
      userId: users.solo.id,
      superAdmin: true,
    });
    expect(granted).toMatchObject({ isSuperAdmin: true, access: "super_admin" });
    // The new super admin can now administer — and demote the first one.
    await expect(listUsers(admin("solo"), { query: tag })).resolves.toMatchObject({ total: 4 });
    const revoked = await setUserSuperAdmin(admin("solo"), {
      userId: users.super.id,
      superAdmin: false,
    });
    // Their domain entry is gone, but their own email entry (kept above) still allowlists them.
    expect(revoked).toMatchObject({ isSuperAdmin: false, isGuest: false });
    await expectCode(listAccessEntries(admin("super")), "FORBIDDEN");
  });

  it("audits every change with its actor", async () => {
    const { rows } = await db.query<{ action: string }>(
      `select action from public.audit_logs
       where actor_id = any($1::uuid[]) and entity_type in ('access_entry', 'user')
       order by id`,
      [[users.super.id, users.solo.id]],
    );
    expect(rows.map((row) => row.action)).toEqual([
      "access.add",
      "access.add",
      "access.add",
      "access.remove",
      "access.add",
      "user.deactivate",
      "user.reactivate",
      "user.super_admin_grant",
      "user.super_admin_revoke",
    ]);
  });
});
