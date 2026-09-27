/**
 * Personal settings contract through supabase-js → PostgREST → RLS + column grants (T1.3):
 * locale/time zone persist in `profiles` (what makes the language follow the user to another
 * device), and a user cannot touch privileged columns or other people's rows.
 *
 * Needs `supabase start` (at least db, rest, kong):
 *   PROFILE_TEST_SUPABASE_URL=http://127.0.0.1:54321
 *   PROFILE_TEST_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long
 *   PROFILE_TEST_ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
 * Skipped when unset.
 */
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getMyProfile, updateMyProfile, type ProfileDb } from "./index";

const URL = process.env.PROFILE_TEST_SUPABASE_URL;
const SECRET = process.env.PROFILE_TEST_JWT_SECRET;
const ADMIN_URL = process.env.PROFILE_TEST_ADMIN_DATABASE_URL;

const ids = { me: randomUUID(), other: randomUUID() };

let db: pg.Client;
let raw: SupabaseClient;
let me: ProfileDb;

async function jwt(claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(SECRET));
}

async function clientFor(userId: string) {
  const anon = await jwt({ role: "anon" });
  const token = await jwt({ role: "authenticated", sub: userId, aud: "authenticated" });
  const client = createClient(URL!, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  // `auth.getUser()` would call GoTrue (not needed here): answer from the JWT subject instead.
  const profileDb = {
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
    from: (table: string) => client.from(table),
  } as unknown as ProfileDb;
  return { client, profileDb };
}

describe.skipIf(!URL || !SECRET || !ADMIN_URL)("profile contract through PostgREST", () => {
  beforeAll(async () => {
    db = new pg.Client({ connectionString: ADMIN_URL });
    await db.connect();
    await db.query(
      "insert into auth.users (id, email, raw_user_meta_data) select id, 'profile-' || id || '@example.com', '{\"full_name\": \"Google Name\"}'::jsonb from unnest($1::uuid[]) as id",
      [Object.values(ids)],
    );
    ({ client: raw, profileDb: me } = await clientFor(ids.me));
  });

  afterAll(async () => {
    await db?.query("delete from auth.users where id = any($1::uuid[])", [Object.values(ids)]);
    await db?.end();
  });

  it("reads the caller's profile with the defaults", async () => {
    expect(await getMyProfile(me)).toEqual({
      id: ids.me,
      email: `profile-${ids.me}@example.com`,
      fullName: "Google Name",
      avatarUrl: null,
      locale: "vi",
      timeZone: "Asia/Ho_Chi_Minh",
    });
  });

  it("persists locale, time zone, name and avatar in profiles", async () => {
    const saved = await updateMyProfile(me, {
      locale: "en",
      timeZone: "Europe/Berlin",
      fullName: "  Lan  ",
      avatarUrl: "https://example.com/lan.png",
    });
    expect(saved).toMatchObject({
      locale: "en",
      timeZone: "Europe/Berlin",
      fullName: "Lan",
      avatarUrl: "https://example.com/lan.png",
    });
    const { rows } = await db.query(
      "select locale, time_zone, full_name, avatar_url from public.profiles where id = $1",
      [ids.me],
    );
    expect(rows).toEqual([
      {
        locale: "en",
        time_zone: "Europe/Berlin",
        full_name: "Lan",
        avatar_url: "https://example.com/lan.png",
      },
    ]);

    // A fresh session (another device) gets the same preferences from the database.
    const { profileDb: elsewhere } = await clientFor(ids.me);
    expect(await getMyProfile(elsewhere)).toMatchObject({
      locale: "en",
      timeZone: "Europe/Berlin",
    });

    const cleared = await updateMyProfile(me, { fullName: "", avatarUrl: null });
    expect(cleared).toMatchObject({ fullName: null, avatarUrl: null });
  });

  it("cannot write privileged columns or another user's row", async () => {
    const privileged = await raw.from("profiles").update({ is_super_admin: true }).eq("id", ids.me);
    expect(privileged.error?.code).toBe("42501");

    const other = await raw
      .from("profiles")
      .update({ locale: "en" })
      .eq("id", ids.other)
      .select("id");
    expect(other.error).toBeNull();
    expect(other.data).toEqual([]);
    const { rows } = await db.query(
      "select locale, is_super_admin from public.profiles where id = any($1::uuid[]) order by id = $2",
      [Object.values(ids), ids.me],
    );
    expect(rows.map((r) => r.is_super_admin)).toEqual([false, false]);
    expect(rows[0].locale).toBe("vi");
  });
});
