import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Attachment contract (task T3.6a, docs/PLAN.md §3.2 `attachments`, §3.5). The editor UI (T3.6b)
 * uploads images and files through these functions; nothing is ever embedded in the document as
 * base64 — the document only stores the attachment id.
 *
 * Every function takes the caller's Supabase client (`createClient()` from `@/lib/supabase/server`)
 * so RLS decides: editors/admins of the page's Space upload and delete, anyone who can view the
 * page reads. Files live in the private bucket `attachments` and are served by short-lived signed
 * URLs only.
 *
 * Upload flow (the browser never gets a service key):
 *
 * ```ts
 * // Server Action
 * const supabase = await createClient();
 * const { attachment, upload } = await createAttachmentUpload(supabase, {
 *   pageId, fileName: "Sơ đồ.png", mimeType: "image/png", sizeBytes: 48213, width: 800, height: 600,
 * });
 * // attachment = { id: "3000…0001", pageId, spaceId, fileName: "Sơ đồ.png", mimeType: "image/png",
 * //   sizeBytes: 48213, width: 800, height: 600, createdAt: "2026-09-27T09:00:00+00:00", … }
 * // upload = { path: "<space>/<page>/<uuid>-so-do.png", token: "…", signedUrl: "https://…" }
 *
 * // Browser: PUT the bytes to the signed URL (no Supabase session needed)
 * await browserSupabase.storage.from("attachments").uploadToSignedUrl(upload.path, upload.token, file);
 *
 * // Render: resolve the id to a signed URL (valid ATTACHMENT_URL_TTL_SECONDS)
 * const { url } = await getAttachmentUrl(supabase, { attachmentId: attachment.id });
 * ```
 *
 * Errors are thrown as {@link AttachmentError} with a code from {@link ATTACHMENT_ERROR_CODES};
 * the UI shows `errors.<code>`.
 */

export const ATTACHMENT_BUCKET = "attachments";

/** 25 MB — same limit as the bucket (`storage.buckets.file_size_limit`) and the table check. */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/** Lifetime of signed download URLs. */
export const ATTACHMENT_URL_TTL_SECONDS = 60 * 60;

/**
 * MIME whitelist — keep in sync with `storage.buckets.allowed_mime_types` in
 * `supabase/migrations/*_attachments.sql`. No SVG/HTML (they can run script when opened).
 */
export const ATTACHMENT_IMAGE_MIME_TYPES = [
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const ATTACHMENT_MIME_TYPES = [
  ...ATTACHMENT_IMAGE_MIME_TYPES,
  "application/msword",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/zip",
  "text/csv",
  "text/markdown",
  "text/plain",
] as const;
export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number];

export function isAllowedAttachmentMimeType(value: string): value is AttachmentMimeType {
  return (ATTACHMENT_MIME_TYPES as readonly string[]).includes(value);
}

export function isImageMimeType(value: string): boolean {
  return (ATTACHMENT_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export const ATTACHMENT_ERROR_CODES = [
  "ATTACHMENT_NOT_FOUND",
  "ATTACHMENT_TOO_LARGE",
  "ATTACHMENT_TYPE_NOT_ALLOWED",
  "ATTACHMENT_UPLOAD_FAILED",
  "FORBIDDEN",
  "PAGE_DELETED",
  "PAGE_NOT_FOUND",
  "VALIDATION_FAILED",
] as const;
export type AttachmentErrorCode = (typeof ATTACHMENT_ERROR_CODES)[number];

export class AttachmentError extends Error {
  constructor(
    readonly code: AttachmentErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = "AttachmentError";
  }
}

const fileName = z
  .string()
  .transform((value) =>
    value
      .normalize("NFC")
      // Control characters and path separators would break the displayed name.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f/\\]+/g, " ")
      .trim(),
  )
  .pipe(z.string().min(1).max(255));

export const createAttachmentUploadInputSchema = z.object({
  pageId: z.guid(),
  /** Original name, shown to users (NFC, control characters and slashes removed). */
  fileName,
  mimeType: z.string().min(3).max(255),
  sizeBytes: z.number().int().positive(),
  /** Pixel size for images (lets the editor reserve space before the image loads). */
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
});
export type CreateAttachmentUploadInput = z.input<typeof createAttachmentUploadInputSchema>;

export const attachmentIdInputSchema = z.object({ attachmentId: z.guid() });
export type AttachmentIdInput = z.input<typeof attachmentIdInputSchema>;

export const listPageAttachmentsInputSchema = z.object({ pageId: z.guid() });
export type ListPageAttachmentsInput = z.input<typeof listPageAttachmentsInputSchema>;

export const attachmentSchema = z.object({
  id: z.guid(),
  pageId: z.guid(),
  spaceId: z.guid(),
  /** Object key in the bucket: `<space_id>/<page_id>/<uuid>-<safe name>`. */
  storagePath: z.string(),
  /** User content, not translated. */
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  uploadedBy: z.guid().nullable(),
  /** ISO 8601 (UTC). */
  createdAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const attachmentUploadSchema = z.object({
  attachment: attachmentSchema,
  upload: z.object({ path: z.string(), token: z.string(), signedUrl: z.string() }),
});
export type AttachmentUpload = z.infer<typeof attachmentUploadSchema>;

export const attachmentUrlSchema = z.object({
  url: z.string(),
  /** ISO 8601 — refresh the URL before this. */
  expiresAt: z.string(),
});
export type AttachmentUrl = z.infer<typeof attachmentUrlSchema>;

const ATTACHMENT_COLUMNS =
  "id, page_id, space_id, storage_path, file_name, mime_type, size_bytes, width, height, uploaded_by, created_at, deleted_at";

const attachmentRowSchema = z
  .object({
    id: z.string(),
    page_id: z.string(),
    space_id: z.string(),
    storage_path: z.string(),
    file_name: z.string(),
    mime_type: z.string(),
    size_bytes: z.coerce.number(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    uploaded_by: z.string().nullable(),
    created_at: z.string(),
    deleted_at: z.string().nullable(),
  })
  .transform((row): Attachment => ({
    id: row.id,
    pageId: row.page_id,
    spaceId: row.space_id,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  }));

/**
 * ASCII-safe object key part from a file name: diacritics removed (đ → d), `[a-z0-9.-]`,
 * extension kept, ≤ 100 chars. The original name is kept in `file_name`.
 */
export function safeObjectName(name: string): string {
  const ascii = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
  const dot = ascii.lastIndexOf(".");
  const clean = (part: string) =>
    part
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  const base = clean(dot > 0 ? ascii.slice(0, dot) : ascii) || "file";
  const ext = dot > 0 ? clean(ascii.slice(dot + 1)).slice(0, 10) : "";
  return ext ? `${base}.${ext}` : base;
}

type PostgrestErrorLike = { code?: string; message?: string } | null;

const TRIGGER_CODES = new Set<AttachmentErrorCode>(["PAGE_DELETED", "PAGE_NOT_FOUND"]);

/** DB error → code: trigger codes pass through, privilege/RLS errors become FORBIDDEN. */
export function toAttachmentError(error: PostgrestErrorLike | unknown): AttachmentError {
  if (error instanceof AttachmentError) return error;
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  if (message && TRIGGER_CODES.has(message as AttachmentErrorCode)) {
    return new AttachmentError(message as AttachmentErrorCode, { cause: error });
  }
  if (code === "42501") return new AttachmentError("FORBIDDEN", { cause: error });
  if (code === "22P02" || code === "23514")
    return new AttachmentError("VALIDATION_FAILED", { cause: error });
  if (code === "23503") return new AttachmentError("PAGE_NOT_FOUND", { cause: error });
  return new AttachmentError("ATTACHMENT_UPLOAD_FAILED", { cause: error });
}

function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new AttachmentError("VALIDATION_FAILED", { cause: result.error });
  return result.data;
}

/**
 * Declares a file on a page and returns a signed upload URL for it. Validates type and size
 * before touching the DB (the bucket enforces both again on upload).
 */
export async function createAttachmentUpload(
  supabase: SupabaseClient,
  input: CreateAttachmentUploadInput,
): Promise<AttachmentUpload> {
  const { pageId, fileName, mimeType, sizeBytes, width, height } = parseInput(
    createAttachmentUploadInputSchema,
    input,
  );
  if (!isAllowedAttachmentMimeType(mimeType))
    throw new AttachmentError("ATTACHMENT_TYPE_NOT_ALLOWED");
  if (sizeBytes > ATTACHMENT_MAX_BYTES) throw new AttachmentError("ATTACHMENT_TOO_LARGE");

  const { data: page, error: pageError } = await supabase
    .from("pages")
    .select("id, space_id, deleted_at")
    .eq("id", pageId)
    .maybeSingle();
  if (pageError) throw toAttachmentError(pageError);
  if (!page) throw new AttachmentError("PAGE_NOT_FOUND");
  const { space_id: spaceId, deleted_at: deletedAt } = page as {
    space_id: string;
    deleted_at: string | null;
  };
  if (deletedAt) throw new AttachmentError("PAGE_DELETED");

  const id = crypto.randomUUID();
  const storagePath = `${spaceId}/${pageId}/${crypto.randomUUID()}-${safeObjectName(fileName)}`;
  const { data, error } = await supabase
    .from("attachments")
    .insert({
      id,
      page_id: pageId,
      storage_path: storagePath,
      file_name: fileName,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      width: width ?? null,
      height: height ?? null,
      // uploaded_by defaults to auth.uid(); RLS requires it to be the caller.
    })
    .select(ATTACHMENT_COLUMNS)
    .single();
  if (error) throw toAttachmentError(error);
  const attachment = attachmentRowSchema.parse(data);

  const { data: signed, error: signError } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (signError || !signed) {
    // Do not leave a declared-but-unusable row behind.
    await supabase
      .from("attachments")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    throw new AttachmentError("ATTACHMENT_UPLOAD_FAILED", { cause: signError });
  }
  return {
    attachment,
    upload: { path: signed.path, token: signed.token, signedUrl: signed.signedUrl },
  };
}

/** Attachment visible to the caller (including soft-deleted ones), or null. */
export async function getAttachment(
  supabase: SupabaseClient,
  input: AttachmentIdInput,
): Promise<Attachment | null> {
  const { attachmentId } = parseInput(attachmentIdInputSchema, input);
  const { data, error } = await supabase
    .from("attachments")
    .select(ATTACHMENT_COLUMNS)
    .eq("id", attachmentId)
    .maybeSingle();
  if (error) throw toAttachmentError(error);
  return data ? attachmentRowSchema.parse(data) : null;
}

/** Live attachments of a page, oldest first. */
export async function listPageAttachments(
  supabase: SupabaseClient,
  input: ListPageAttachmentsInput,
): Promise<Attachment[]> {
  const { pageId } = parseInput(listPageAttachmentsInputSchema, input);
  const { data, error } = await supabase
    .from("attachments")
    .select(ATTACHMENT_COLUMNS)
    .eq("page_id", pageId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw toAttachmentError(error);
  return z.array(attachmentRowSchema).parse(data ?? []);
}

/**
 * Signed download URL for a live attachment the caller can view. `download: true` makes the
 * browser save the file under its original name instead of displaying it.
 */
export async function getAttachmentUrl(
  supabase: SupabaseClient,
  input: AttachmentIdInput & { download?: boolean },
): Promise<AttachmentUrl> {
  const attachment = await getAttachment(supabase, input);
  if (!attachment || attachment.deletedAt) throw new AttachmentError("ATTACHMENT_NOT_FOUND");
  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(
      attachment.storagePath,
      ATTACHMENT_URL_TTL_SECONDS,
      input.download ? { download: attachment.fileName } : undefined,
    );
  // Not uploaded yet, or no read access to the object: same answer, no existence leak.
  if (error || !data) throw new AttachmentError("ATTACHMENT_NOT_FOUND", { cause: error });
  return {
    url: data.signedUrl,
    expiresAt: new Date(Date.now() + ATTACHMENT_URL_TTL_SECONDS * 1000).toISOString(),
  };
}

/** Soft-deletes an attachment (editors of the page). Its object stops being readable at once. */
export async function deleteAttachment(
  supabase: SupabaseClient,
  input: AttachmentIdInput,
): Promise<void> {
  const { attachmentId } = parseInput(attachmentIdInputSchema, input);
  const attachment = await getAttachment(supabase, { attachmentId });
  if (!attachment) throw new AttachmentError("ATTACHMENT_NOT_FOUND");
  if (attachment.deletedAt) return;
  const { data, error } = await supabase
    .from("attachments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", attachmentId)
    .select("id");
  if (error) throw toAttachmentError(error);
  if (!data || data.length === 0) throw new AttachmentError("FORBIDDEN");
}
