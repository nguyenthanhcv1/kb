// @vitest-environment happy-dom
import enNav from "@kb/i18n/messages/en/nav.json";
import viNav from "@kb/i18n/messages/vi/nav.json";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname: string | null = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const { MainNav, isActivePath } = await import("./main-nav");

afterEach(cleanup);

function renderNav(locale: "vi" | "en") {
  render(
    <NextIntlClientProvider locale={locale} messages={{ nav: locale === "vi" ? viNav : enNav }}>
      <MainNav />
    </NextIntlClientProvider>,
  );
}

describe("isActivePath", () => {
  it("matches Home only on /", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/search", "/")).toBe(false);
  });

  it("matches a section and the pages below it, not look-alike prefixes", () => {
    expect(isActivePath("/search", "/search")).toBe(true);
    expect(isActivePath("/whats-new/1.0.0", "/whats-new")).toBe(true);
    expect(isActivePath("/search-old", "/search")).toBe(false);
    expect(isActivePath(null, "/")).toBe(false);
  });
});

describe("MainNav", () => {
  it("links Home, Search and What's new in Vietnamese", () => {
    pathname = "/";
    renderNav("vi");
    expect(screen.getByRole("link", { name: "Trang chủ" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Tìm kiếm" }).getAttribute("href")).toBe("/search");
    expect(screen.getByRole("link", { name: "Có gì mới" }).getAttribute("href")).toBe("/whats-new");
  });

  it("marks only the current section with aria-current", () => {
    pathname = "/whats-new";
    renderNav("en");
    expect(screen.getByRole("link", { name: "What's new" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Search" }).getAttribute("aria-current")).toBeNull();
  });
});
