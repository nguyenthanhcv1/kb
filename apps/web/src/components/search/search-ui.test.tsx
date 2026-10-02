// @vitest-environment happy-dom
import enErrors from "@kb/i18n/messages/en/errors.json";
import enSearch from "@kb/i18n/messages/en/search.json";
import enTree from "@kb/i18n/messages/en/tree.json";
import viErrors from "@kb/i18n/messages/vi/errors.json";
import viSearch from "@kb/i18n/messages/vi/search.json";
import viTree from "@kb/i18n/messages/vi/tree.json";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formats } from "@kb/i18n";

import type { SearchHit } from "@/server/search/links";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const { QuickSwitcher } = await import("./quick-switcher");
const { ResultsView, resultsHref } = await import("./results-view");
const { parseSnippet } = await import("./snippet");

const messages = {
  vi: { search: viSearch, errors: viErrors, tree: viTree },
  en: { search: enSearch, errors: enErrors, tree: enTree },
};

function renderWith(ui: ReactNode, locale: "vi" | "en" = "vi") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={messages[locale]}
      formats={formats}
      timeZone="Asia/Ho_Chi_Minh"
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

const hit = (n: number, extra: Partial<SearchHit> = {}): SearchHit => ({
  pageId: `20000000-0000-4000-8000-00000000000${n}`,
  spaceId: "10000000-0000-4000-8000-00000000000a",
  title: `Trang ${n}`,
  snippetHtml: "Nhân viên được <mark>nghỉ</mark> phép &amp; lễ",
  matchIn: "body",
  score: 1,
  lastEditedAt: "2026-09-26T09:00:00+00:00",
  href: `/s/design/p/trang-${n}`,
  spaceSlug: "design",
  spaceName: "Design",
  icon: null,
  ...extra,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  push.mockReset();
  window.localStorage.clear();
});

describe("parseSnippet", () => {
  it("splits marks from text and decodes entities", () => {
    expect(parseSnippet("a <mark>b</mark> &lt;c&gt; &amp; d")).toEqual([
      { text: "a ", mark: false },
      { text: "b", mark: true },
      { text: " <c> & d", mark: false },
    ]);
  });
});

describe("QuickSwitcher", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ results: [hit(1), hit(2)] }),
    );
  });

  async function openAndType(text: string) {
    renderWith(<QuickSwitcher />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: text } });
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(1));
    return input;
  }

  it("opens with Ctrl+K and closes with Escape", async () => {
    renderWith(<QuickSwitcher />);
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByRole("combobox");
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  });

  it("navigates results with the arrow keys and opens the active one with Enter", async () => {
    const input = await openAndType("nghi phep");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/search?q=nghi%20phep"),
      expect.anything(),
    );
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3); // two pages + "see all"
    expect(options[0]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]!.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]!.id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/s/design/p/trang-2");
    expect(JSON.parse(window.localStorage.getItem("kb.search.recent")!)[0].href).toBe(
      "/s/design/p/trang-2",
    );
  });

  it("leads to the full results page from the last row (wraps with ArrowUp)", async () => {
    const input = await openAndType("nghi phep");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/search?q=nghi%20phep");
  });

  it("shows a translated error", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      Response.json({ error: "RATE_LIMITED" }, { status: 429 }),
    );
    renderWith(<QuickSwitcher />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "abc" } });
    expect((await screen.findByRole("alert")).textContent).toContain(viErrors.RATE_LIMITED);
  });

  it("lists recent pages when the box is empty", async () => {
    window.localStorage.setItem(
      "kb.search.recent",
      JSON.stringify([{ href: "/s/a/p/x", title: "Gần đây", icon: null, spaceName: "A" }]),
    );
    renderWith(<QuickSwitcher />, "en");
    await act(async () => {
      fireEvent.keyDown(window, { key: "K", ctrlKey: true });
    });
    expect(await screen.findByText(enSearch.quickSwitcher.recent)).toBeTruthy();
    expect(screen.getByRole("option", { name: /Gần đây/ })).toBeTruthy();
  });
});

describe("ResultsView", () => {
  const base = {
    query: "nghi phep",
    spaceId: "",
    spaces: [{ id: "10000000-0000-4000-8000-00000000000a", name: "Design" }],
    page: 1,
    hasNext: false,
    errorCode: null,
  };

  it("renders hits with highlighted snippet, match label and Space", () => {
    renderWith(<ResultsView {...base} hits={[hit(1, { matchIn: "table" }), hit(2)]} />, "vi");
    expect(screen.getByRole("link", { name: /Trang 1/ }).getAttribute("href")).toBe(
      "/s/design/p/trang-1",
    );
    expect(screen.getByText(viSearch.matchIn.table)).toBeTruthy();
    expect(document.querySelectorAll("mark").length).toBe(2);
    expect(screen.getByRole("status").textContent).toContain("2 kết quả");
  });

  it("shows the empty state in both languages", () => {
    renderWith(<ResultsView {...base} hits={[]} />, "en");
    expect(screen.getByText("No results for “nghi phep”")).toBeTruthy();
  });

  it("shows the error state with the translated code", () => {
    renderWith(<ResultsView {...base} hits={[]} errorCode="RATE_LIMITED" />);
    expect(screen.getByRole("alert").textContent).toContain(viErrors.RATE_LIMITED);
  });

  it("paginates with links that keep the filters", () => {
    renderWith(<ResultsView {...base} spaceId="s1" page={2} hasNext hits={[hit(1)]} />);
    expect(
      screen.getByRole("link", { name: viSearch.results.pagination.previous }).getAttribute("href"),
    ).toBe("/search?q=nghi+phep&space=s1");
    expect(
      screen.getByRole("link", { name: viSearch.results.pagination.next }).getAttribute("href"),
    ).toBe("/search?q=nghi+phep&space=s1&page=3");
  });

  it("builds results hrefs", () => {
    expect(resultsHref("", "", 1)).toBe("/search");
  });
});
