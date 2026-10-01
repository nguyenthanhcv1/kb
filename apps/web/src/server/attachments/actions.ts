"use server";

import { createClient } from "@/lib/supabase/server";

import {
  AttachmentError,
  type AttachmentErrorCode,
  createAttachmentUpload as createAttachmentUploadCore,
  type CreateAttachmentUploadInput,
} from "./index";

/**
 * Server Action of the T3.6a attachment contract for the editor upload (T3.6b). Runs with the
 * caller's session, so RLS decides who may upload. Expected failures come back as
 * `{ ok: false, error }` → show `errors.<error>`.
 */
export type CreateAttachmentUploadResult =
  | {
      ok: true;
      data: { attachmentId: string; path: string; token: string };
    }
  | { ok: false; error: AttachmentErrorCode };

export async function createAttachmentUpload(
  input: CreateAttachmentUploadInput,
): Promise<CreateAttachmentUploadResult> {
  try {
    const { attachment, upload } = await createAttachmentUploadCore(await createClient(), input);
    return {
      ok: true,
      data: { attachmentId: attachment.id, path: upload.path, token: upload.token },
    };
  } catch (error) {
    if (error instanceof AttachmentError) return { ok: false, error: error.code };
    console.error("[attachments] unexpected error", error);
    return { ok: false, error: "ATTACHMENT_UPLOAD_FAILED" };
  }
}
