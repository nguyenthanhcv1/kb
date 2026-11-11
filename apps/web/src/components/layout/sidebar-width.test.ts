import { describe, expect, it } from "vitest";

import {
  clampSidebarWidth,
  parseSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from "./sidebar-width";

describe("parseSidebarWidth", () => {
  it("falls back to the default when missing or invalid", () => {
    expect(parseSidebarWidth(undefined)).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(parseSidebarWidth("")).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(parseSidebarWidth("abc")).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(parseSidebarWidth("-5")).toBe(SIDEBAR_WIDTH_DEFAULT);
  });

  it("keeps a valid width and clamps out-of-range ones", () => {
    expect(parseSidebarWidth("320")).toBe(320);
    expect(parseSidebarWidth("50")).toBe(SIDEBAR_WIDTH_MIN);
    expect(parseSidebarWidth("9999")).toBe(SIDEBAR_WIDTH_MAX);
  });
});

describe("clampSidebarWidth", () => {
  it("rounds and clamps", () => {
    expect(clampSidebarWidth(300.6)).toBe(301);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_WIDTH_DEFAULT);
  });
});
