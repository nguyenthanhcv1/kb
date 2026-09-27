import { describe, expect, it } from "vitest";

import { deriveSpaceSlug, isValidSpaceSlug, normalizeSlugInput } from "./slug";

describe("deriveSpaceSlug", () => {
  it.each([
    ["Kỹ thuật", "ky-thuat"],
    ["Đội Vận hành & Kho", "doi-van-hanh-kho"],
    ["  Design  ", "design"],
    ["Sổ tay nhân viên 2026", "so-tay-nhan-vien-2026"],
    ["HR / Tuyển dụng", "hr-tuyen-dung"],
    ["--Nội---bộ--", "noi-bo"],
    ["🎨 Design", "design"],
  ])("%p → %p", (name, slug) => {
    expect(deriveSpaceSlug(name)).toBe(slug);
    expect(isValidSpaceSlug(slug)).toBe(true);
  });

  it("cuts at 50 characters without a trailing hyphen", () => {
    const slug = deriveSpaceSlug(`${"a".repeat(49)} bcd`);
    expect(slug).toBe("a".repeat(49));
    expect(deriveSpaceSlug("x".repeat(80))).toHaveLength(50);
  });

  it("may return a too-short slug for the user to fix", () => {
    expect(deriveSpaceSlug("A")).toBe("a");
    expect(deriveSpaceSlug("🎨")).toBe("");
    expect(isValidSpaceSlug("a")).toBe(false);
    expect(isValidSpaceSlug("")).toBe(false);
  });
});

describe("isValidSpaceSlug", () => {
  it.each(["ab", "design-team", "t1-4b", "a".repeat(50)])("accepts %p", (slug) => {
    expect(isValidSpaceSlug(slug)).toBe(true);
  });

  it.each(["a", "a".repeat(51), "Design", "ky thuat", "kỹ-thuật", "under_score", "a/b"])(
    "rejects %p",
    (slug) => {
      expect(isValidSpaceSlug(slug)).toBe(false);
    },
  );
});

describe("normalizeSlugInput", () => {
  it("lower-cases and turns spaces into hyphens", () => {
    expect(normalizeSlugInput("Design Team")).toBe("design-team");
  });
});
