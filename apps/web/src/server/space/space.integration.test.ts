/**
 * Space contract through supabase-js → PostgREST → RLS/triggers (the fake db of index.test.ts
 * cannot reproduce Postgres' RLS checks on `INSERT/UPDATE … RETURNING`).
 *
 * Needs `supabase start` (at least db, rest, kong):
 *   SPACES_TEST_SUPABASE_URL=http://127.0.0.1:54321
 *   SPACES_TEST_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long
 *   SPACES_TEST_ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
 * Skipped when unset.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  archiveSpace,
  createSpace,
  getSpaceBySlug,
  listSpaces,
  SpaceError,
  updateSpace,
  type SpaceDb,
} from "./index";

const URL = process.env.SPACES_TEST_SUPABASE_URL;
const SECRET = process.env.SPACES_TEST_JWT_SECRET;
const ADMIN_URL = process.env.SPACES_TEST_ADMIN_DATABASE_URL;

const ids = { creator: randomUUID(), colleague: randomUUID(), guest: randomUUID() };
const run = ids.creator.slice(0, 8);

let db: pg.Client;
const as: Record<keyof typeof ids, SpaceDb> = {} as never;

async function jwt(claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(SECRET));
}

async function clientFor(userId: string): Promise<SpaceDb> {
  const anon = await jwt({ role: "anon" });
  const token = await jwt({ role: "authenticated", sub: userId, aud: "authenticated" });
  const client = createClient(URL!, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  // `auth.getUser()` would call GoTrue (not needed here): answer from the JWT subject instead.
  return {
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
    from: (table: string) => client.from(table),
  } as unknown as SpaceDb;
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy(
    (error) => error instanceof SpaceError && error.code === code,
  );
}

describe.skipIf(!URL || !SECRET || !ADMIN_URL)("space contract through PostgREST", () => {
  beforeAll(async () => {
    db = new pg.Client({ connectionString: ADMIN_URL });
    await db.connect();
    await db.query("begin");
    await db.query(
      "insert into auth.users (id, email) select id, 'spaces-' || id || '@example.com' from unnest($1::uuid[]) as id",
      [Object.values(ids)],
    );
    await db.query("select set_config('request.jwt.claim.role', 'service_role', true)");
    await db.query("update public.profiles set is_guest = (id = $3) where id in ($1, $2, $3)", [
      ids.creator,
      ids.colleague,
      ids.guest,
    ]);
    await db.query("commit");
    for (const who of Object.keys(ids) as (keyof typeof ids)[]) as[who] = await clientFor(ids[who]);
  });

  afterAll(async () => {
    // Rows stay (unique slugs per run): deleting a Space cascades into its last admin, which
    // `app.guard_last_space_admin` refuses by design.
    await db?.end();
  });

  it("creates a restricted Space whose creator is its admin", async () => {
    const space = await createSpace(as.creator, { slug: `r-${run}`, name: "Restricted" });
    expect(space).toMatchObject({ slug: `r-${run}`, visibility: "restricted", role: "admin" });

    const { rows } = await db.query(
      "select role from public.space_members where space_id = $1 and user_id = $2",
      [space.id, ids.creator],
    );
    expect(rows).toEqual([{ role: "admin" }]);
    expect(await getSpaceBySlug(as.colleague, { slug: `r-${run}` })).toBeNull();
  });

  it("reports a duplicate slug and rejects guests", async () => {
    await createSpace(as.creator, { slug: `dup-${run}`, name: "First" });
    await expectCode(
      createSpace(as.creator, { slug: `dup-${run}`, name: "Second" }),
      "SPACE_SLUG_TAKEN",
    );
    await expectCode(createSpace(as.guest, { slug: `g-${run}`, name: "Guest" }), "FORBIDDEN");
  });

  it("lets only admins update an internal Space", async () => {
    const space = await createSpace(as.creator, {
      slug: `i-${run}`,
      name: "Internal",
      visibility: "internal",
    });
    expect((await getSpaceBySlug(as.colleague, { slug: `i-${run}` }))?.role).toBe("viewer");
    await expectCode(updateSpace(as.colleague, { id: space.id, name: "Nope" }), "FORBIDDEN");

    const updated = await updateSpace(as.creator, { id: space.id, name: "Internal team" });
    expect(updated.name).toBe("Internal team");
  });

  it("archives a Space, which then disappears for everyone", async () => {
    const space = await createSpace(as.creator, { slug: `a-${run}`, name: "To archive" });
    await expectCode(archiveSpace(as.colleague, { id: space.id }), "SPACE_NOT_FOUND");

    await archiveSpace(as.creator, { id: space.id });
    const { rows } = await db.query("select archived_at from public.spaces where id = $1", [
      space.id,
    ]);
    expect(rows[0].archived_at).not.toBeNull();
    expect(await getSpaceBySlug(as.creator, { slug: `a-${run}` })).toBeNull();
    const { spaces } = await listSpaces(as.creator);
    expect(spaces.map((s) => s.id)).not.toContain(space.id);
    await expectCode(archiveSpace(as.creator, { id: space.id }), "SPACE_NOT_FOUND");
  });
});
