import { describe, expect, it } from "vitest";

import {
  canonicalPageRedirect,
  pageHref,
  pageRef,
  parsePageRef,
  spaceTrashHref,
} from "./page-href";

describe("pageRef / pageHref", () => {
  it("joins slug and short id, or uses the short id alone for untitled pages", () => {
    expect(pageRef({ slug: "huong-dan", shortId: "a1B2c3D4" })).toBe("huong-dan-a1B2c3D4");
    expect(pageRef({ slug: "", shortId: "a1B2c3D4" })).toBe("a1B2c3D4");
    expect(pageHref("design", { slug: "huong-dan", shortId: "a1B2c3D4" })).toBe(
      "/s/design/p/huong-dan-a1B2c3D4",
    );
    expect(spaceTrashHref("design")).toBe("/s/design/trash");
  });
});

describe("parsePageRef", () => {
  it("takes the short id after the last dash", () => {
    expect(parsePageRef("quy-trinh-nghi-phep-2026-a1B2c3D4")).toEqual({
      slug: "quy-trinh-nghi-phep-2026",
      shortId: "a1B2c3D4",
    });
    expect(parsePageRef("a1B2c3D4")).toEqual({ slug: "", shortId: "a1B2c3D4" });
    expect(parsePageRef("-a1B2c3D4")).toEqual({ slug: "", shortId: "a1B2c3D4" });
  });

  it("decodes the segment", () => {
    expect(parsePageRef("h%C6%B0%E1%BB%9Bng-a1B2c3D4")).toEqual({
      slug: "hướng",
      shortId: "a1B2c3D4",
    });
    expect(parsePageRef("%E0%A4%A-a1B2c3D4")).toEqual({ slug: "%E0%A4%A", shortId: "a1B2c3D4" });
  });

  it("rejects segments without a valid short id", () => {
    expect(parsePageRef("")).toBeNull();
    expect(parsePageRef("huong-dan")).toBeNull();
    expect(parsePageRef("huong-dan-a1B2c3D")).toBeNull();
    expect(parsePageRef("huong-dan-a1B2c3D45")).toBeNull();
    expect(parsePageRef("huong-dan-a1B2_3D4")).toBeNull();
  });
});

describe("canonicalPageRedirect", () => {
  const page = { spaceSlug: "design", slug: "huong-dan-moi", shortId: "a1B2c3D4" };

  it("keeps the canonical URL", () => {
    expect(
      canonicalPageRedirect({ spaceSlug: "design", ref: "huong-dan-moi-a1B2c3D4" }, page),
    ).toBe(null);
  });

  it("redirects an old slug, a missing slug or another Space to the canonical URL", () => {
    const href = "/s/design/p/huong-dan-moi-a1B2c3D4";
    expect(canonicalPageRedirect({ spaceSlug: "design", ref: "huong-dan-cu-a1B2c3D4" }, page)).toBe(
      href,
    );
    expect(canonicalPageRedirect({ spaceSlug: "design", ref: "a1B2c3D4" }, page)).toBe(href);
    expect(
      canonicalPageRedirect({ spaceSlug: "old-space", ref: "huong-dan-moi-a1B2c3D4" }, page),
    ).toBe(href);
    expect(
      canonicalPageRedirect({ spaceSlug: "Design", ref: "huong-dan-moi-a1B2c3D4" }, page),
    ).toBe(href);
  });

  it("drops a stale slug of an untitled page", () => {
    expect(
      canonicalPageRedirect({ spaceSlug: "design", ref: "old-a1B2c3D4" }, { ...page, slug: "" }),
    ).toBe("/s/design/p/a1B2c3D4");
  });
});
