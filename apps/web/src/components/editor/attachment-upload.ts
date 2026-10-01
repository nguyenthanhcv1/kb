import {
  ATTACHMENT_MAX_BYTES,
  type AttachmentErrorCode,
  isAllowedAttachmentMimeType,
  isImageMimeType,
} from "@/server/attachments";
import type { CreateAttachmentUploadResult } from "@/server/attachments/actions";

export class AttachmentUploadError extends Error {
  constructor(readonly code: AttachmentErrorCode) {
    super(code);
    this.name = "AttachmentUploadError";
  }
}

export type UploadedFile = { id: string; fileName: string; isImage: boolean };

export type UploadDeps = {
  /** Server Action: declares the file and returns a signed upload target. */
  createUpload: (input: {
    pageId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
  }) => Promise<CreateAttachmentUploadResult>;
  /** Sends the bytes to the signed URL (browser → Storage; no service key in the browser). */
  putFile: (target: { path: string; token: string }, file: File) => Promise<{ error: unknown }>;
  /** Pixel size of an image, or `null` when it cannot be read. */
  measureImage?: (file: File) => Promise<{ width: number; height: number } | null>;
};

/** Checks type and size before any network call (the server and the bucket check them again). */
export function validateUpload(file: Pick<File, "type" | "size">): AttachmentErrorCode | null {
  if (!isAllowedAttachmentMimeType(file.type)) return "ATTACHMENT_TYPE_NOT_ALLOWED";
  if (file.size > ATTACHMENT_MAX_BYTES) return "ATTACHMENT_TOO_LARGE";
  if (file.size === 0) return "VALIDATION_FAILED";
  return null;
}

/** Uploads one file to a page's attachments and returns what the editor needs to insert it. */
export async function uploadAttachment(
  pageId: string,
  file: File,
  deps: UploadDeps,
): Promise<UploadedFile> {
  const invalid = validateUpload(file);
  if (invalid) throw new AttachmentUploadError(invalid);

  const isImage = isImageMimeType(file.type);
  const size = isImage ? await deps.measureImage?.(file).catch(() => null) : null;
  const created = await deps.createUpload({
    pageId,
    fileName: file.name || "file",
    mimeType: file.type,
    sizeBytes: file.size,
    width: size?.width ?? null,
    height: size?.height ?? null,
  });
  if (!created.ok) throw new AttachmentUploadError(created.error);

  const { error } = await deps.putFile(created.data, file);
  if (error) throw new AttachmentUploadError("ATTACHMENT_UPLOAD_FAILED");
  return { id: created.data.attachmentId, fileName: file.name || "file", isImage };
}

/** Reads the natural size of an image file in the browser. */
export async function measureImage(file: File): Promise<{ width: number; height: number } | null> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => resolve(null);
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
