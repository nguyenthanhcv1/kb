import { describe, expect, it } from "vitest";

import { csvFileName } from "../../src/table/csv";

// 2026-09-25T18:30:00Z is already 2026-09-26 in Asia/Ho_Chi_Minh (UTC+7).
const DATE = new Date("2026-09-25T18:30:00Z");

describe("csvFileName", () => {
  it("keeps Vietnamese letters and appends .csv", () => {
    expect(csvFileName("Báo cáo doanh thu")).toBe("Báo cáo doanh thu.csv");
  });

  it("appends the date in Asia/Ho_Chi_Minh", () => {
    expect(csvFileName("Kế hoạch", DATE)).toBe("Kế hoạch 2026-09-26.csv");
  });

  it("ignores an invalid date", () => {
    expect(csvFileName("x", new Date("nope"))).toBe("x.csv");
  });

  it("normalises to NFC", () => {
    const name = csvFileName("Tiếng Việt".normalize("NFD"));
    expect(name).toBe("Tiếng Việt.csv");
    expect(name).toBe(name.normalize("NFC"));
  });

  it("replaces path separators and reserved characters", () => {
    expect(csvFileName("Q1/2026: kết quả?")).toBe("Q1-2026- kết quả-.csv");
    expect(csvFileName('a\\b*c"d<e>f|g')).toBe("a-b-c-d-e-f-g.csv");
    expect(csvFileName("../../etc/passwd")).toBe("etc-passwd.csv");
  });

  it("removes control and invisible characters and collapses whitespace", () => {
    expect(csvFileName("a\u0000b\nc\t\td\u200be\u202ef")).toBe("a b c d e f.csv");
    expect(csvFileName("  nhiều    khoảng   trắng  ")).toBe("nhiều khoảng trắng.csv");
  });

  it("strips leading dots and trailing dots/spaces and a duplicated .csv", () => {
    expect(csvFileName(".hidden")).toBe("hidden.csv");
    expect(csvFileName("tên...")).toBe("tên.csv");
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

  it("caps the base name at 100 characters without splitting a letter", () => {
    const name = csvFileName("ệ".repeat(150));
    expect(name).toBe(`${"ệ".repeat(100)}.csv`);
  });
});
