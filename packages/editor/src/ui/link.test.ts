import { describe, expect, it } from "vitest";

import { normalizeImageSrc, normalizeLinkHref } from "./link";

describe("normalizeLinkHref", () => {
  it.each([
    ["https://example.com/a?b=1", "https://example.com/a?b=1"],
    ["example.com/docs", "https://example.com/docs"],
    ["  kb.local.vn  ", "https://kb.local.vn/"],
    ["mailto:ai@example.com", "mailto:ai@example.com"],
    ["/s/eng/p/abc", "/s/eng/p/abc"],
    ["#heading", "#heading"],
    ["http://localhost:3000", "http://localhost:3000/"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeLinkHref(input)).toBe(expected);
  });

  it.each(["", "   ", "javascript:alert(1)", "data:text/html,x", "not a link", "word"])(
    "refuses %j",
    (input) => {
      expect(normalizeLinkHref(input)).toBeNull();
    },
  );
});

describe("normalizeImageSrc", () => {
  it("accepts absolute http(s) URLs only", () => {
    expect(normalizeImageSrc("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(normalizeImageSrc("data:image/png;base64,AAAA")).toBeNull();
    expect(normalizeImageSrc("example.com/a.png")).toBeNull();
    expect(normalizeImageSrc("javascript:alert(1)")).toBeNull();
  });
});
