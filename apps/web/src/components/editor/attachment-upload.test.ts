import { describe, expect, it, vi } from "vitest";

import {
  AttachmentUploadError,
  type UploadDeps,
  uploadAttachment,
  validateUpload,
} from "./attachment-upload";

const PAGE = "2000a000-0000-4000-8000-000000000001";
const ok = {
  ok: true as const,
  data: { attachmentId: "3000a000-0000-4000-8000-000000000001", path: "p", token: "t" },
};

function deps(overrides: Partial<UploadDeps> = {}): UploadDeps {
  return {
    createUpload: vi.fn().mockResolvedValue(ok),
    putFile: vi.fn().mockResolvedValue({ error: null }),
    measureImage: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
    ...overrides,
  };
}

describe("validateUpload", () => {
  it("accepts allowed types within the limit", () => {
    expect(validateUpload({ type: "image/png", size: 10 })).toBeNull();
    expect(validateUpload({ type: "application/pdf", size: 10 })).toBeNull();
  });

  it("refuses SVG, unknown types, empty and oversized files", () => {
    expect(validateUpload({ type: "image/svg+xml", size: 10 })).toBe("ATTACHMENT_TYPE_NOT_ALLOWED");
    expect(validateUpload({ type: "", size: 10 })).toBe("ATTACHMENT_TYPE_NOT_ALLOWED");
    expect(validateUpload({ type: "image/png", size: 26 * 1024 * 1024 })).toBe(
      "ATTACHMENT_TOO_LARGE",
    );
    expect(validateUpload({ type: "image/png", size: 0 })).toBe("VALIDATION_FAILED");
  });
});

describe("uploadAttachment", () => {
  it("declares, uploads and returns the attachment with image size", async () => {
    const d = deps();
    const file = new File(["abc"], "Sơ đồ.png", { type: "image/png" });
    await expect(uploadAttachment(PAGE, file, d)).resolves.toEqual({
      id: ok.data.attachmentId,
      fileName: "Sơ đồ.png",
      isImage: true,
    });
    expect(d.createUpload).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: PAGE, mimeType: "image/png", width: 800, height: 600 }),
    );
    expect(d.putFile).toHaveBeenCalledWith(ok.data, file);
  });

  it("does not measure or hit the network for refused files", async () => {
    const d = deps();
    const file = new File(["x"], "a.exe", { type: "application/x-msdownload" });
    await expect(uploadAttachment(PAGE, file, d)).rejects.toMatchObject({
      code: "ATTACHMENT_TYPE_NOT_ALLOWED",
    });
    expect(d.createUpload).not.toHaveBeenCalled();
  });

  it("passes server error codes through", async () => {
    const d = deps({
      createUpload: vi.fn().mockResolvedValue({ ok: false, error: "FORBIDDEN" }),
    });
    const file = new File(["x"], "a.pdf", { type: "application/pdf" });
    await expect(uploadAttachment(PAGE, file, d)).rejects.toBeInstanceOf(AttachmentUploadError);
    await expect(uploadAttachment(PAGE, file, d)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(d.putFile).not.toHaveBeenCalled();
  });

  it("reports a failed transfer", async () => {
    const d = deps({ putFile: vi.fn().mockResolvedValue({ error: new Error("net") }) });
    const file = new File(["x"], "a.pdf", { type: "application/pdf" });
    await expect(uploadAttachment(PAGE, file, d)).rejects.toMatchObject({
      code: "ATTACHMENT_UPLOAD_FAILED",
    });
  });
});
