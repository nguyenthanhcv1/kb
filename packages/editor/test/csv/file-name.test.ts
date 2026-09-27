import { describe, expect, it } from "vitest";

import { csvFileName } from "../../src/table/csv";

// 2026-09-25T18:30:00Z is already 2026-09-26 in Asia/Ho_Chi_Minh (UTC+7).
const DATE = new Date("2026-09-25T18:30:00Z");

describe("csvFileName", () => {
  it("drops Vietnamese diacritics, keeps case and appends .csv", () => {
    expect(csvFileName("Báo cáo doanh thu")).toBe("Bao cao doanh thu.csv");
    expect(csvFileName("Đặc biệt ĐÔNG đúc")).toBe("Dac biet DONG duc.csv");
  });

  it("appends the date in Asia/Ho_Chi_Minh", () => {
    expect(csvFileName("Kế hoạch", DATE)).toBe("Ke hoach 2026-09-26.csv");
  });

  it("ignores an invalid date", () => {
    expect(csvFileName("x", new Date("nope"))).toBe("x.csv");
  });

  it("handles NFD input", () => {
    expect(csvFileName("Tiếng Việt".normalize("NFD"))).toBe("Tieng Viet.csv");
  });

  it("replaces path separators and reserved characters", () => {
    expect(csvFileName("Q1/2026: kết quả?")).toBe("Q1-2026- ket qua-.csv");
    expect(csvFileName('a\\b*c"d<e>f|g')).toBe("a-b-c-d-e-f-g.csv");
    expect(csvFileName("../../etc/passwd")).toBe("etc-passwd.csv");
  });

  it("removes control and invisible characters and collapses whitespace", () => {
    expect(csvFileName("a\u0000b\nc\t\td\u200be\u202ef")).toBe("a b c d e f.csv");
    expect(csvFileName("  nhiều    khoảng   trắng  ")).toBe("nhieu khoang trang.csv");
  });

  it("strips leading dots and trailing dots/spaces and a duplicated .csv", () => {
    expect(csvFileName(".hidden")).toBe("hidden.csv");
    expect(csvFileName("tên...")).toBe("ten.csv");
    expect(csvFileName("data.CSV")).toBe("data.csv");
  });

  it("falls back to 'table' for empty or unusable titles", () => {
    expect(csvFileName(undefined)).toBe("table.csv");
    expect(csvFileName("")).toBe("table.csv");
    expect(csvFileName("  /// ... ")).toBe("table.csv");
    expect(csvFileName(undefined, DATE)).toBe("table 2026-09-26.csv");
  });

  it("avoids Windows reserved device names", () => {
    expect(csvFileName("CON")).toBe("CON_.csv");
    expect(csvFileName("lpt1")).toBe("lpt1_.csv");
    expect(csvFileName("console")).toBe("console.csv");
  });

  it("keeps non-Latin letters that have no ASCII form and caps the base name at 100 characters", () => {
    expect(csvFileName("日本語")).toBe("日本語.csv");
    expect(csvFileName("ệ".repeat(150))).toBe(`${"e".repeat(100)}.csv`);
    expect(csvFileName("😀".repeat(150))).toBe(`${"😀".repeat(100)}.csv`);
  });
});
