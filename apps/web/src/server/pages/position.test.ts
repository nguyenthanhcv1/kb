import { describe, expect, it } from "vitest";

import { comparePositions, isValidPosition, keyBetween } from "./position";

function check(before: string | null, after: string | null) {
  const key = keyBetween(before, after);
  expect(isValidPosition(key)).toBe(true);
  if (before !== null) expect(comparePositions(before, key)).toBe(-1);
  if (after !== null) expect(comparePositions(key, after)).toBe(-1);
  return key;
}

describe("keyBetween", () => {
  it("starts in the middle", () => {
    expect(keyBetween(null, null)).toBe("V");
  });

  it.each([
    [null, "V"],
    ["V", null],
    ["V", "W"],
    ["V", "V1"],
    ["1", "2"],
    [null, "1"],
    [null, "01"],
    ["z", null],
    ["zz", null],
    ["a", "a01"],
    ["Zz", "a"],
    ["a0V", "a1"],
  ])("finds a key between %j and %j", (before, after) => {
    check(before, after);
  });

  it("grows about one character per 31 appends", () => {
    let key: string | null = null;
    for (let i = 0; i < 1_000; i++) key = check(key, null);
    expect(key!.length).toBeLessThanOrEqual(34);
  });

  it("keeps order under repeated inserts at the front and in the middle", () => {
    const keys = [keyBetween(null, null)];
    for (let i = 0; i < 200; i++) keys.unshift(check(null, keys[0]!));
    for (let i = 0; i < 200; i++) keys.splice(101, 0, check(keys[100]!, keys[101]!));
    expect([...keys].sort(comparePositions)).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("rejects invalid or unordered input", () => {
    expect(() => keyBetween("b", "a")).toThrow();
    expect(() => keyBetween("a", "a")).toThrow();
    expect(() => keyBetween("a0", null)).toThrow();
    expect(() => keyBetween("a-b", null)).toThrow();
  });
});
