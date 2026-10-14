/**
 * Page sharing through supabase-js → PostgREST → RLS/SQL functions: a Space admin shares a page
 * with an existing guest (granted at once) and with an email without an account (page
 * invitation → accepted → share); the guest then reaches the page and its subpages (and their
 * Space name) but nothing else; roles change, shares are removed or left.
 *
 * Needs `supabase start` (at least db, rest, kong):
 *   PAGE_SHARES_TEST_SUPABASE_URL=http://127.0.0.1:54321
 *   PAGE_SHARES_TEST_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long
 *   PAGE_SHARES_TEST_ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
 * Skipped when the variables are unset.
 */
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { acceptInvitation, type MembersDb } from "@/server/members";
import { getPageByShortId, listChildPages } from "@/server/pages";

import {
  PageShareError,
  changePageShareRole,
  getMyPageRole,
  leaveSharedPage,
  listPageShares,
  listSharedWithMe,
  removePageShare,
  sharePage,
  type PageShareErrorCode,
} from "./index";

const URL = process.env.PAGE_SHARES_TEST_SUPABASE_URL;
const SECRET = process.env.PAGE_SHARES_TEST_JWT_SECRET;
const ADMIN_URL = process.env.PAGE_SHARES_TEST_ADMIN_DATABASE_URL;

const run = randomUUID().slice(0, 8);
const ids = {
  admin: randomUUID(),
  editor: randomUUID(),
  guest: randomUUID(),
  invitee: randomUUID(),
  space: randomUUID(),
  root: randomUUID(),
  child: randomUUID(),
  sibling: randomUUID(),
};
const emails = {
  admin: `shares-${run}-admin@example.com`,
  editor: `shares-${run}-editor@example.com`,
  guest: `shares-${run}-guest@partner.test`,
  invitee: `shares-${run}-invitee@partner.test`,
};
type Who = keyof typeof emails;

let db: pg.Client;
const as = {} as Record<Who, SupabaseClient>;
const deps = { appUrl: "http://localhost:3000", mailer: null };

async function jwt(claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(SECRET));
}

async function clientFor(userId: string): Promise<SupabaseClient> {
  const anon = await jwt({ role: "anon" });
  const token = await jwt({ role: "authenticated", sub: userId, aud: "authenticated" });
  const client = createClient(URL!, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  // `auth.getUser()` would call GoTrue (not running in CI); the JWT's `sub` is what RLS uses.
  const auth = { getUser: async () => ({ data: { user: { id: userId } }, error: null }) };
  return new Proxy(client, {
    get: (target, key, receiver) => (key === "auth" ? auth : Reflect.get(target, key, receiver)),
  });
}

async function expectCode(promise: Promise<unknown>, code: PageShareErrorCode) {
  await expect(promise).rejects.toSatisfy(
    (error) => error instanceof PageShareError && error.code === code,
  );
}

describe.skipIf(!URL || !SECRET || !ADMIN_URL)("page sharing through PostgREST", () => {
  beforeAll(async () => {
    db = new pg.Client({ connectionString: ADMIN_URL });
    await db.connect();
    await db.query("begin");
    // The invitee has no account until they accept (inserted later).
    const users = [ids.admin, ids.editor, ids.guest];
    await db.query(
      "insert into auth.users (id, email) select * from unnest($1::uuid[], $2::text[])",
      [users, [emails.admin, emails.editor, emails.guest]],
    );
    await db.query("select set_config('request.jwt.claim.role', 'service_role', true)");
    await db.query("update public.profiles set is_guest = false where id = any($1::uuid[])", [
      [ids.admin, ids.editor],
    ]);
    await db.query("select set_config('request.jwt.claim.role', '', true)");
    await db.query(
      "insert into public.spaces (id, slug, name, created_by) values ($1, $2, 'Shares test', $3)",
      [ids.space, `sh-${run}`, ids.admin],
    );
    await db.query(
      "insert into public.space_members (space_id, user_id, role, added_by) values ($1, $2, 'editor', $3)",
      [ids.space, ids.editor, ids.admin],
    );
    await db.query(
      `insert into public.pages (id, space_id, parent_id, position, title, created_by) values
         ($1, $3, null, 'a0', 'Hợp đồng ${run}', $4),
         ($2, $3, null, 'a1', 'Nội bộ ${run}', $4)`,
      [ids.root, ids.sibling, ids.space, ids.admin],
    );
    await db.query(
      `insert into public.pages (id, space_id, parent_id, position, title, created_by)
       values ($1, $2, $3, 'a0', 'Phụ lục ${run}', $4)`,
      [ids.child, ids.space, ids.root, ids.admin],
    );
    await db.query("commit");
    for (const who of ["admin", "editor", "guest"] as const) as[who] = await clientFor(ids[who]);
  });

  afterAll(async () => {
    if (!db) return;
    await db.query("update public.spaces set archived_at = now() where id = $1", [ids.space]);
    await db.end();
  });

  it("only Space admins share and see the shares", async () => {
    await expectCode(
      sharePage(as.editor, { pageId: ids.root, email: emails.guest, role: "viewer" }, deps),
      "FORBIDDEN",
    );
    await expectCode(listPageShares(as.editor, { pageId: ids.root }), "FORBIDDEN");
    await expectCode(listPageShares(as.guest, { pageId: ids.root }), "PAGE_NOT_FOUND");
  });

  it("shares with an existing guest, who then reaches the page and its subpages only", async () => {
    const result = await sharePage(
      as.admin,
      { pageId: ids.root, email: emails.guest.toUpperCase(), role: "viewer" },
      deps,
    );
    expect(result).toMatchObject({ status: "granted", userId: ids.guest, emailStatus: "skipped" });

    const shared = await listSharedWithMe(as.guest);
    expect(shared).toEqual([
      expect.objectContaining({
        pageId: ids.root,
        spaceSlug: `sh-${run}`,
        spaceName: "Shares test",
        role: "viewer",
        hasChildren: true,
      }),
    ]);
    const children = await listChildPages(as.guest, { spaceId: ids.space, parentId: ids.root });
    expect(children.map((page) => page.id)).toEqual([ids.child]);
    expect(await listChildPages(as.guest, { spaceId: ids.space, parentId: null })).toEqual([
      expect.objectContaining({ id: ids.root }),
    ]);
    const { rows } = await db.query<{ short_id: string }>(
      "select short_id from public.pages where id = any($1::uuid[]) order by title",
      [[ids.child, ids.sibling]],
    );
    const [sibling, child] = rows as [{ short_id: string }, { short_id: string }];
    expect(await getPageByShortId(as.guest, { shortId: child.short_id })).toMatchObject({
      id: ids.child,
      spaceSlug: `sh-${run}`,
    });
    expect(await getPageByShortId(as.guest, { shortId: sibling.short_id })).toBeNull();
    expect(await getMyPageRole(as.guest, { pageId: ids.child })).toBe("viewer");
    expect(await getMyPageRole(as.guest, { pageId: ids.sibling })).toBeNull();

    const { shares } = await listPageShares(as.admin, { pageId: ids.child });
    expect(shares).toEqual([
      expect.objectContaining({ userId: ids.guest, inherited: true, sourcePageId: ids.root }),
    ]);
  });

  it("changes the role and removes a share", async () => {
    await changePageShareRole(as.admin, { pageId: ids.root, userId: ids.guest, role: "editor" });
    expect(await getMyPageRole(as.guest, { pageId: ids.child })).toBe("editor");
    await expectCode(
      changePageShareRole(as.guest, { pageId: ids.root, userId: ids.guest, role: "editor" }),
      "PAGE_SHARE_NOT_FOUND",
    );
    await removePageShare(as.admin, { pageId: ids.root, userId: ids.guest });
    expect(await getMyPageRole(as.guest, { pageId: ids.root })).toBeNull();
    expect(await listSharedWithMe(as.guest)).toEqual([]);
  });

  it("invites an email without an account to the page; accepting grants the share", async () => {
    const result = await sharePage(
      as.admin,
      { pageId: ids.child, email: emails.invitee, role: "editor" },
      deps,
    );
    if (result.status !== "invited") throw new Error("expected an invitation");
    expect(result.invitation).toMatchObject({ pageId: ids.child, spaceId: ids.space });
    await expectCode(
      sharePage(as.admin, { pageId: ids.child, email: emails.invitee, role: "viewer" }, deps),
      "INVITATION_ALREADY_PENDING",
    );
    expect((await listPageShares(as.admin, { pageId: ids.child })).invitations).toEqual([
      expect.objectContaining({ email: emails.invitee, status: "pending" }),
    ]);

    // The invitee signs up (allowed by the pending invitation) and accepts.
    await db.query("insert into auth.users (id, email) values ($1, $2)", [
      ids.invitee,
      emails.invitee,
    ]);
    as.invitee = await clientFor(ids.invitee);
    const token = decodeURIComponent(result.inviteUrl.split("/invite/")[1]!);
    const accepted = await acceptInvitation(as.invitee as unknown as MembersDb, { token });
    expect(accepted).toMatchObject({
      spaceSlug: `sh-${run}`,
      role: "editor",
      page: { id: ids.child },
    });
    expect(await getMyPageRole(as.invitee, { pageId: ids.child })).toBe("editor");
    expect(await getMyPageRole(as.invitee, { pageId: ids.root })).toBeNull();

    await leaveSharedPage(as.invitee, { pageId: ids.child });
    expect(await getMyPageRole(as.invitee, { pageId: ids.child })).toBeNull();
  });
});
