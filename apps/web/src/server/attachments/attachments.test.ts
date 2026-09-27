import en from "@kb/i18n/messages/en/errors.json";
import vi from "@kb/i18n/messages/vi/errors.json";
import { describe, expect, it } from "vitest";

import {
  AttachmentError,
  ATTACHMENT_ERROR_CODES,
  isAllowedAttachmentMimeType,
  safeObjectName,
  toAttachmentError,
} from "./index";

describe("safeObjectName", () => {
  it("removes Vietnamese diacritics and keeps the extension", () => {
    expect(safeObjectName("Sơ đồ tổ chức (bản 2).PNG")).toBe("so-do-to-chuc-ban-2.png");
    expect(safeObjectName("Đề xuất.docx")).toBe("de-xuat.docx");
  });

  it("falls back to a generic name", () => {
    expect(safeObjectName("???")).toBe("file");
    expect(safeObjectName(".env")).toBe("env");
  });

  it("caps the length", () => {
    expect(safeObjectName(`${"a".repeat(300)}.pdf`)).toBe(`${"a".repeat(80)}.pdf`);
  });
});

describe("MIME whitelist", () => {
  it("allows images and office documents but not SVG or HTML", () => {
    expect(isAllowedAttachmentMimeType("image/png")).toBe(true);
    expect(isAllowedAttachmentMimeType("application/pdf")).toBe(true);
    expect(isAllowedAttachmentMimeType("image/svg+xml")).toBe(false);
    expect(isAllowedAttachmentMimeType("text/html")).toBe(false);
  });
});

describe("toAttachmentError", () => {
  it("maps DB errors to codes", () => {
    expect(toAttachmentError({ code: "42501" }).code).toBe("FORBIDDEN");
    expect(toAttachmentError({ code: "P0001", message: "PAGE_DELETED" }).code).toBe("PAGE_DELETED");
    expect(toAttachmentError({ code: "23514", message: "ATTACHMENT_PATH_INVALID" }).code).toBe(
      "VALIDATION_FAILED",
    );
    expect(toAttachmentError(new Error("boom")).code).toBe("ATTACHMENT_UPLOAD_FAILED");
    const same = new AttachmentError("ATTACHMENT_TOO_LARGE");
    expect(toAttachmentError(same)).toBe(same);
  });

  it("every code has a translation", () => {
    for (const code of ATTACHMENT_ERROR_CODES) {
      expect(en).toHaveProperty(code);
      expect(vi).toHaveProperty(code);
    }
  });
});
