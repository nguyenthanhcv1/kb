/**
 * Attachment contract through supabase-js → PostgREST/Storage API → RLS (T3.6a acceptance:
 * a viewer of another Space cannot download the file).
 *
 * Needs `supabase start` with db, rest, kong and storage-api:
 *   ATTACHMENTS_TEST_SUPABASE_URL=http://127.0.0.1:54321
 *   ATTACHMENTS_TEST_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long
 *   ATTACHMENTS_TEST_ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
 * Skipped when unset.
 */
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ATTACHMENT_BUCKET,
  AttachmentError,
  createAttachmentUpload,
  deleteAttachment,
  getAttachmentUrl,
  listPageAttachments,
} from "./index";

const URL = process.env.ATTACHMENTS_TEST_SUPABASE_URL;
const SECRET = process.env.ATTACHMENTS_TEST_JWT_SECRET;
const ADMIN_URL = process.env.ATTACHMENTS_TEST_ADMIN_DATABASE_URL;

const ids = {
  admin: randomUUID(),
  editor: randomUUID(),
  viewer: randomUUID(),
  outsider: randomUUID(),
  space: randomUUID(),
  otherSpace: randomUUID(),
  page: randomUUID(),
};

let db: pg.Client;
const as: Record<"editor" | "viewer" | "outsider", SupabaseClient> = {} as never;
const uploaded: string[] = [];

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
    (error) => error instanceof AttachmentError && error.code === code,
  );
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

describe.skipIf(!URL || !SECRET || !ADMIN_URL)("attachments through PostgREST and Storage", () => {
  beforeAll(async () => {
    db = new pg.Client({ connectionString: ADMIN_URL });
    await db.connect();
    const users = [ids.admin, ids.editor, ids.viewer, ids.outsider];
    await db.query("begin");
    await db.query(
      "insert into auth.users (id, email) select id, 'att-' || id || '@example.com' from unnest($1::uuid[]) as id",
      [users],
    );
    await db.query("select set_config('request.jwt.claim.role', 'service_role', true)");
    await db.query("update public.profiles set is_guest = false where id = any($1::uuid[])", [
      users,
    ]);
    await db.query("select set_config('request.jwt.claim.role', '', true)");
    await db.query(
      `insert into public.spaces (id, slug, name, created_by) values
         ($1, $3, 'Attachments test', $5), ($2, $4, 'Other', $5)`,
      [
        ids.space,
        ids.otherSpace,
        `at-${ids.space.slice(0, 8)}`,
        `at-${ids.otherSpace.slice(0, 8)}`,
        ids.admin,
      ],
    );
    await db.query(
      `insert into public.space_members (space_id, user_id, role, added_by)
       values ($1, $3, 'editor', $6), ($1, $4, 'viewer', $6), ($2, $5, 'viewer', $6)`,
      [ids.space, ids.otherSpace, ids.editor, ids.viewer, ids.outsider, ids.admin],
    );
    await db.query(
      "insert into public.pages (id, space_id, position, title, created_by) values ($1, $2, 'V', 'Ảnh', $3)",
      [ids.page, ids.space, ids.editor],
    );
    await db.query("commit");
    for (const role of ["editor", "viewer", "outsider"] as const)
      as[role] = await clientFor(ids[role]);
  });

  afterAll(async () => {
    if (!db) return;
    if (uploaded.length > 0) {
      const service = createClient(URL!, await jwt({ role: "service_role" }), {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await service.storage.from(ATTACHMENT_BUCKET).remove(uploaded);
    }
    await db.query("update public.pages set deleted_at = now() where id = $1", [ids.page]);
    await db.query("delete from public.pages where id = $1", [ids.page]);
    await db.end();
  });

  it("editor uploads through a signed URL; viewers read it, other Spaces get nothing", async () => {
    const { attachment, upload } = await createAttachmentUpload(as.editor, {
      pageId: ids.page,
      fileName: "Sơ đồ.png",
      mimeType: "image/png",
      sizeBytes: PNG.length,
      width: 1,
      height: 1,
    });
    uploaded.push(upload.path);
    expect(attachment).toMatchObject({
      pageId: ids.page,
      spaceId: ids.space,
      fileName: "Sơ đồ.png",
      uploadedBy: ids.editor,
      deletedAt: null,
    });
    expect(upload.path).toMatch(new RegExp(`^${ids.space}/${ids.page}/[0-9a-f-]{36}-so-do\\.png$`));

    const { error } = await as.editor.storage
      .from(ATTACHMENT_BUCKET)
      .uploadToSignedUrl(upload.path, upload.token, new Blob([PNG], { type: "image/png" }), {
        contentType: "image/png",
      });
    expect(error).toBeNull();

    const { url } = await getAttachmentUrl(as.viewer, { attachmentId: attachment.id });
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(PNG)).toBe(true);

    expect(await listPageAttachments(as.viewer, { pageId: ids.page })).toHaveLength(1);
    expect(await listPageAttachments(as.outsider, { pageId: ids.page })).toEqual([]);
    await expectCode(
      getAttachmentUrl(as.outsider, { attachmentId: attachment.id }),
      "ATTACHMENT_NOT_FOUND",
    );
    // Even with the object key, the Storage API refuses the outsider.
    const { data: direct, error: directError } = await as.outsider.storage
      .from(ATTACHMENT_BUCKET)
      .download(upload.path);
    expect(direct).toBeNull();
    expect(directError).not.toBeNull();

    // Undeclared objects cannot be uploaded straight to the bucket.
    const { error: rogue } = await as.editor.storage
      .from(ATTACHMENT_BUCKET)
      .upload(`${ids.space}/${ids.page}/${randomUUID()}-rogue.png`, PNG, {
        contentType: "image/png",
      });
    expect(rogue).not.toBeNull();

    await expectCode(deleteAttachment(as.viewer, { attachmentId: attachment.id }), "FORBIDDEN");
    await deleteAttachment(as.editor, { attachmentId: attachment.id });
    await expectCode(
      getAttachmentUrl(as.viewer, { attachmentId: attachment.id }),
      "ATTACHMENT_NOT_FOUND",
    );
  });

  it("rejects disallowed types, oversized files, viewers and pages out of reach", async () => {
    const base = { pageId: ids.page, fileName: "x.png", mimeType: "image/png", sizeBytes: 10 };
    await expectCode(
      createAttachmentUpload(as.editor, { ...base, fileName: "x.svg", mimeType: "image/svg+xml" }),
      "ATTACHMENT_TYPE_NOT_ALLOWED",
    );
    await expectCode(
      createAttachmentUpload(as.editor, { ...base, sizeBytes: 25 * 1024 * 1024 + 1 }),
      "ATTACHMENT_TOO_LARGE",
    );
    await expectCode(createAttachmentUpload(as.viewer, base), "FORBIDDEN");
    await expectCode(createAttachmentUpload(as.outsider, base), "PAGE_NOT_FOUND");
    await expectCode(
      createAttachmentUpload(as.editor, { ...base, fileName: "" }),
      "VALIDATION_FAILED",
    );
  });
});
