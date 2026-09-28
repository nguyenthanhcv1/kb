/**
 * Page actions through supabase-js → PostgREST → RLS/triggers (T2.2 acceptance).
 *
 * Needs `supabase start` (at least db, rest, kong):
 *   PAGES_TEST_SUPABASE_URL=http://127.0.0.1:54321
 *   PAGES_TEST_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long
 *   PAGES_TEST_ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
 * Skipped when unset.
 */
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPage,
  getPageByShortId,
  getPageContent,
  listChildPages,
  listTrash,
  movePage,
  PageError,
  purgePage,
  renamePage,
  restorePage,
  setPageIcon,
  trashPage,
} from "./index";

const URL = process.env.PAGES_TEST_SUPABASE_URL;
const SECRET = process.env.PAGES_TEST_JWT_SECRET;
const ADMIN_URL = process.env.PAGES_TEST_ADMIN_DATABASE_URL;

const ids = {
  admin: randomUUID(),
  editor: randomUUID(),
  viewer: randomUUID(),
  outsider: randomUUID(),
  space: randomUUID(),
  otherSpace: randomUUID(),
};

let db: pg.Client;
const as: Record<"admin" | "editor" | "viewer" | "outsider", SupabaseClient> = {} as never;

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
    (error) => error instanceof PageError && error.code === code,
  );
}

const titles = (pages: { title: string }[]) => pages.map((page) => page.title);

describe.skipIf(!URL || !SECRET || !ADMIN_URL)("page actions through PostgREST", () => {
  beforeAll(async () => {
    db = new pg.Client({ connectionString: ADMIN_URL });
    await db.connect();
    const users = [ids.admin, ids.editor, ids.viewer, ids.outsider];
    await db.query("begin");
    await db.query(
      "insert into auth.users (id, email) select id, 'pages-' || id || '@example.com' from unnest($1::uuid[]) as id",
      [users],
    );
    await db.query("select set_config('request.jwt.claim.role', 'service_role', true)");
    await db.query("update public.profiles set is_guest = false where id = any($1::uuid[])", [
      users,
    ]);
    await db.query("select set_config('request.jwt.claim.role', '', true)");
    await db.query(
      `insert into public.spaces (id, slug, name, created_by) values
         ($1, $3, 'Pages test', $5), ($2, $4, 'Other', $5)`,
      [
        ids.space,
        ids.otherSpace,
        `pg-${ids.space.slice(0, 8)}`,
        `pg-${ids.otherSpace.slice(0, 8)}`,
        ids.admin,
      ],
    );
    await db.query(
      `insert into public.space_members (space_id, user_id, role, added_by)
       values ($1, $2, 'editor', $4), ($1, $3, 'viewer', $4)`,
      [ids.space, ids.editor, ids.viewer, ids.admin],
    );
    await db.query("commit");
    for (const role of ["admin", "editor", "viewer", "outsider"] as const)
      as[role] = await clientFor(ids[role]);
  });

  afterAll(async () => {
    if (!db) return;
    await db.query(
      "update public.pages set deleted_at = now() where space_id = any($1::uuid[]) and parent_id is null",
      [[ids.space, ids.otherSpace]],
    );
    await db.query(
      "delete from public.pages where space_id = any($1::uuid[]) and parent_id is null",
      [[ids.space, ids.otherSpace]],
    );
    await db.end();
  });

  it("creates pages in order; viewers and outsiders cannot", async () => {
    const a = await createPage(as.editor, { spaceId: ids.space, title: "  Alpha  " });
    const c = await createPage(as.editor, { spaceId: ids.space, title: "Charlie" });
    await createPage(as.editor, { spaceId: ids.space, title: "Bravo", afterId: a.id });
    await createPage(as.editor, { spaceId: ids.space, title: "Zero", afterId: null });
    expect(a).toMatchObject({ title: "Alpha", slug: "alpha", parentId: null, spaceId: ids.space });
    expect(c.shortId).toMatch(/^[0-9A-Za-z]{8}$/);

    expect(titles(await listChildPages(as.viewer, { spaceId: ids.space, parentId: null }))).toEqual(
      ["Zero", "Alpha", "Bravo", "Charlie"],
    );
    await expectCode(createPage(as.viewer, { spaceId: ids.space, title: "No" }), "FORBIDDEN");
    await expectCode(createPage(as.outsider, { spaceId: ids.space, title: "No" }), "FORBIDDEN");
    expect(await listChildPages(as.outsider, { spaceId: ids.space, parentId: null })).toEqual([]);
  });

  it("renames, and reports FORBIDDEN / PAGE_NOT_FOUND", async () => {
    const [zero] = await listChildPages(as.editor, { spaceId: ids.space, parentId: null });
    const renamed = await renamePage(as.editor, { pageId: zero!.id, title: "Mục lục", icon: "📘" });
    expect(renamed).toMatchObject({ title: "Mục lục", slug: "muc-luc", icon: "📘" });
    await expectCode(renamePage(as.viewer, { pageId: zero!.id, title: "x" }), "FORBIDDEN");
    await expectCode(renamePage(as.outsider, { pageId: zero!.id, title: "x" }), "PAGE_NOT_FOUND");
    await expectCode(
      renamePage(as.editor, { pageId: "not-a-uuid", title: "x" }),
      "VALIDATION_FAILED",
    );
  });

  it("moves pages between parents and positions, never into their own subtree", async () => {
    const roots = await listChildPages(as.editor, { spaceId: ids.space, parentId: null });
    const [muc, alpha, bravo, charlie] = roots;
    await movePage(as.editor, { pageId: bravo!.id, parentId: alpha!.id });
    await movePage(as.editor, { pageId: charlie!.id, parentId: alpha!.id, afterId: null });

    const children = await listChildPages(as.editor, { spaceId: ids.space, parentId: alpha!.id });
    expect(titles(children)).toEqual(["Charlie", "Bravo"]);
    expect(
      (await listChildPages(as.editor, { spaceId: ids.space, parentId: null })).find(
        (p) => p.id === alpha!.id,
      ),
    ).toMatchObject({ hasChildren: true });

    await expectCode(
      movePage(as.editor, { pageId: alpha!.id, parentId: bravo!.id }),
      "PAGE_MOVE_CYCLE",
    );
    await expectCode(
      movePage(as.editor, { pageId: alpha!.id, parentId: alpha!.id }),
      "PAGE_MOVE_CYCLE",
    );
    await expectCode(movePage(as.viewer, { pageId: muc!.id, parentId: alpha!.id }), "FORBIDDEN");

    // Reorder at the root: Mục lục goes after Alpha.
    await movePage(as.editor, { pageId: muc!.id, parentId: null, afterId: alpha!.id });
    expect(titles(await listChildPages(as.editor, { spaceId: ids.space, parentId: null }))).toEqual(
      ["Alpha", "Mục lục"],
    );
  });

  it("moves a subtree to another space only with edit rights there", async () => {
    const [alpha] = await listChildPages(as.admin, { spaceId: ids.space, parentId: null });
    await expectCode(
      movePage(as.editor, { pageId: alpha!.id, parentId: null, spaceId: ids.otherSpace }),
      "FORBIDDEN",
    );

    await movePage(as.admin, { pageId: alpha!.id, parentId: null, spaceId: ids.otherSpace });
    const moved = await listChildPages(as.admin, { spaceId: ids.otherSpace, parentId: alpha!.id });
    expect(titles(moved)).toEqual(["Charlie", "Bravo"]);
    expect(moved.every((page) => page.spaceId === ids.otherSpace)).toBe(true);

    await movePage(as.admin, {
      pageId: alpha!.id,
      parentId: null,
      spaceId: ids.space,
      afterId: null,
    });
  });

  it("trashes and restores a branch; restores under a trashed parent to the root", async () => {
    const [alpha] = await listChildPages(as.editor, { spaceId: ids.space, parentId: null });
    const [charlie] = await listChildPages(as.editor, { spaceId: ids.space, parentId: alpha!.id });

    await trashPage(as.editor, { pageId: alpha!.id });
    expect(titles(await listChildPages(as.editor, { spaceId: ids.space, parentId: null }))).toEqual(
      ["Mục lục"],
    );
    expect(titles(await listTrash(as.editor, { spaceId: ids.space })).sort()).toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
    ]);
    expect(await listTrash(as.viewer, { spaceId: ids.space })).toEqual([]);
    await expectCode(trashPage(as.viewer, { pageId: charlie!.id }), "PAGE_NOT_FOUND");

    // Parent still in the trash → Charlie comes back as the last root page.
    const restored = await restorePage(as.editor, { pageId: charlie!.id });
    expect(restored).toMatchObject({ parentId: null, deletedAt: null });
    expect(titles(await listChildPages(as.editor, { spaceId: ids.space, parentId: null }))).toEqual(
      ["Mục lục", "Charlie"],
    );

    await restorePage(as.editor, { pageId: alpha!.id });
    expect(
      titles(await listChildPages(as.editor, { spaceId: ids.space, parentId: alpha!.id })),
    ).toEqual(["Bravo"]);
  });

  it("purges only from the trash and only as a space admin", async () => {
    const [alpha] = await listChildPages(as.admin, { spaceId: ids.space, parentId: null });
    await expectCode(purgePage(as.admin, { pageId: alpha!.id }), "PAGE_NOT_IN_TRASH");

    await trashPage(as.editor, { pageId: alpha!.id });
    await expectCode(renamePage(as.editor, { pageId: alpha!.id, title: "x" }), "PAGE_DELETED");
    await expectCode(movePage(as.editor, { pageId: alpha!.id, parentId: null }), "PAGE_DELETED");
    await expectCode(purgePage(as.editor, { pageId: alpha!.id }), "FORBIDDEN");
    await purgePage(as.admin, { pageId: alpha!.id });
    expect(titles(await listTrash(as.admin, { spaceId: ids.space }))).toEqual([]);

    const { rows } = await db.query(
      "select action from public.audit_logs where space_id = $1 and action like 'page.%' order by id",
      [ids.space],
    );
    expect(new Set(rows.map((row) => row.action))).toEqual(
      new Set([
        "page.create",
        "page.update_title",
        "page.move",
        "page.delete",
        "page.restore_from_trash",
        "page.purge",
      ]),
    );
  });

  it("finds a page by short id with its Space slug, sets its icon and reads its content", async () => {
    const page = await createPage(as.editor, { spaceId: ids.space, title: "Tra cứu" });
    expect(await getPageByShortId(as.viewer, { shortId: page.shortId })).toMatchObject({
      id: page.id,
      slug: "tra-cuu",
      spaceSlug: `pg-${ids.space.slice(0, 8)}`,
    });
    expect(await getPageByShortId(as.outsider, { shortId: page.shortId })).toBeNull();
    expect(await getPageByShortId(as.viewer, { shortId: "not-an-id" })).toBeNull();

    // A rename changes the slug, never the short id: old links resolve to the renamed page.
    await renamePage(as.editor, { pageId: page.id, title: "Tra cứu mới" });
    expect(await getPageByShortId(as.viewer, { shortId: page.shortId })).toMatchObject({
      shortId: page.shortId,
      slug: "tra-cuu-moi",
    });

    expect(await setPageIcon(as.editor, { pageId: page.id, icon: " 🚀 " })).toMatchObject({
      icon: "🚀",
      title: "Tra cứu mới",
    });
    expect(await setPageIcon(as.editor, { pageId: page.id, icon: "" })).toMatchObject({
      icon: null,
    });
    await expectCode(setPageIcon(as.viewer, { pageId: page.id, icon: "x" }), "FORBIDDEN");

    expect(await getPageContent(as.viewer, { pageId: page.id })).toEqual({
      contentJson: { type: "doc", content: [] },
      schemaVersion: 1,
    });
    expect(await getPageContent(as.outsider, { pageId: page.id })).toBeNull();

    // Trashed: editors still open it (to restore it), viewers no longer see it.
    await trashPage(as.editor, { pageId: page.id });
    expect(await getPageByShortId(as.editor, { shortId: page.shortId })).toMatchObject({
      deletedAt: expect.any(String),
    });
    expect(await getPageByShortId(as.viewer, { shortId: page.shortId })).toBeNull();
    await expectCode(setPageIcon(as.editor, { pageId: page.id, icon: "x" }), "PAGE_DELETED");
  });
});
