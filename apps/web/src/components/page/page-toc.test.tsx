// @vitest-environment happy-dom
import enTree from "@kb/i18n/messages/en/tree.json";
import viTree from "@kb/i18n/messages/vi/tree.json";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { activeHeadingIndex, collectHeadings, PageToc } from "./page-toc";

afterEach(cleanup);

function body(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `<div class="kb-editor-content">${html}</div>`;
  document.body.append(root);
  return root;
}

describe("collectHeadings", () => {
  it("lists h1-h3 of the body in order, skipping empty ones and other headings", () => {
    const root = body(
      "<h1>Mục đích</h1><p>x</p><h2> Các bước </h2><h3></h3><h3>Ngoại lệ</h3><h4>Nhỏ</h4>",
    );
    root.insertAdjacentHTML("beforeend", "<h2>Ngoài nội dung</h2>");
    expect(collectHeadings(root).map(({ level, text }) => [level, text])).toEqual([
      [1, "Mục đích"],
      [2, "Các bước"],
      [3, "Ngoại lệ"],
    ]);
  });
});

describe("activeHeadingIndex", () => {
  it("picks the last heading that has reached the offset, the first one before any", () => {
    expect(activeHeadingIndex([300, 700, 1200], 120)).toBe(0);
    expect(activeHeadingIndex([-400, 90, 800], 120)).toBe(1);
    expect(activeHeadingIndex([-900, -300, 40], 120)).toBe(2);
    expect(activeHeadingIndex([], 120)).toBe(0);
  });
});

describe("PageToc", () => {
  function renderToc(root: HTMLElement, locale: "vi" | "en" = "vi") {
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = root;
    return render(
      <NextIntlClientProvider
        locale={locale}
        messages={{ tree: locale === "vi" ? viTree : enTree }}
      >
        <PageToc rootRef={ref} />
      </NextIntlClientProvider>,
    );
  }

  it("lists the headings under 'On this page' and scrolls to the clicked one", async () => {
    const user = userEvent.setup();
    const root = body("<h2>Mục đích</h2><h2>Các bước</h2>");
    const target = root.querySelectorAll("h2")[1]!;
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    renderToc(root);

    expect(await screen.findByRole("navigation")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: viTree.page.toc.label })).toBeTruthy();
    expect(screen.getByText(viTree.page.toc.title)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Các bước" }));
    expect(scroll).toHaveBeenCalledOnce();
  });

  it("renders nothing for a page without headings", async () => {
    renderToc(body("<p>Chỉ có đoạn văn</p>"), "en");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
