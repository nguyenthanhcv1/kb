import { describe, expect, it } from "vitest";

import { formats, normalizeVi, slugifyVi } from "./format";

describe("normalizeVi", () => {
  it("strips Vietnamese tones and diacritics", () => {
    expect(normalizeVi("Nghỉ phép")).toBe("nghi phep");
    expect(normalizeVi("Cơ sở dữ liệu")).toBe("co so du lieu");
    expect(normalizeVi("Tiếng Việt: ăâêôơư")).toBe("tieng viet: aaeoou");
  });

  it("maps đ/Đ to d", () => {
    expect(normalizeVi("Đường đi")).toBe("duong di");
  });

  it("treats NFC and NFD input the same", () => {
    const nfc = "Quy định".normalize("NFC");
    const nfd = "Quy định".normalize("NFD");
    expect(nfc).not.toBe(nfd);
    expect(normalizeVi(nfc)).toBe(normalizeVi(nfd));
  });

  it("keeps ASCII, digits and punctuation", () => {
    expect(normalizeVi("NV-00123 / Q3")).toBe("nv-00123 / q3");
  });
});

describe("slugifyVi", () => {
  it("builds URL-safe slugs", () => {
    expect(slugifyVi("  Quy trình nghỉ phép 2026!  ")).toBe("quy-trinh-nghi-phep-2026");
    expect(slugifyVi("Đào tạo & Phát triển")).toBe("dao-tao-phat-trien");
    expect(slugifyVi("!!!")).toBe("");
  });
});

describe("formats", () => {
  it("are valid Intl options for both locales", () => {
    const date = new Date("2026-09-25T03:04:00Z");
    for (const locale of ["vi", "en"]) {
      for (const options of Object.values(formats.dateTime)) {
        expect(() =>
          new Intl.DateTimeFormat(locale, { ...options, timeZone: "Asia/Ho_Chi_Minh" }).format(
            date,
          ),
        ).not.toThrow();
      }
      for (const options of Object.values(formats.number)) {
        expect(() => new Intl.NumberFormat(locale, options).format(1536)).not.toThrow();
      }
    }
    expect(
      new Intl.DateTimeFormat("vi", {
        ...formats.dateTime.dateShort,
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(date),
    ).toBe("25/09/2026");
  });
});
