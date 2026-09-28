// @vitest-environment happy-dom
import enErrors from "@kb/i18n/messages/en/errors.json";
import enTree from "@kb/i18n/messages/en/tree.json";
import viErrors from "@kb/i18n/messages/vi/errors.json";
import viTree from "@kb/i18n/messages/vi/tree.json";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
let pathname = "/s/design";
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => pathname,
}));
// The default API is the Server Actions; every test passes an in-memory one instead.
vi.mock("@/server/pages/actions", () => ({
  createPageAction: vi.fn(),
  listChildPagesAction: vi.fn(),
  movePageAction: vi.fn(),
  renamePageAction: vi.fn(),
  trashPageAction: vi.fn(),
}));

const { PageTree } = await import("./page-tree");
const { PageBreadcrumb, visibleCrumbs } = await import("./page-breadcrumb");
const { createMemoryPageTreeApi } = await import("./test-support");

const SPACE = { id: "5bace000-0000-4000-8000-000000000001", slug: "design", name: "Design" };
const messages = {
  vi: { errors: viErrors, tree: viTree },
  en: { errors: enErrors, tree: enTree },
};

function renderWith(ui: ReactNode, locale: "vi" | "en" = "vi") {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Asia/Ho_Chi_Minh">
      {ui}
    </NextIntlClientProvider>,
  );
}

function seed() {
  return createMemoryPageTreeApi(SPACE.id, [
    { id: "guide", parentId: null, title: "Hướng dẫn", icon: "📘" },
    { id: "leave", parentId: "guide", title: "Nghỉ phép" },
    { id: "onboard", parentId: "guide", title: "Onboarding" },
    { id: "policy", parentId: null, title: "Chính sách" },
    { id: "blank", parentId: null, title: "" },
  ]);
}

const tree = () => screen.getByRole("tree");
const item = (name: string | RegExp) => within(tree()).getByRole("treeitem", { name });
const itemNames = () =>
  within(tree())
    .getAllByRole("treeitem")
    .map((element) => element.textContent);

beforeEach(() => {
  pathname = "/s/design";
  window.localStorage.clear();
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("PageTree", () => {
  it("loads the root pages, then children only when a page is expanded", async () => {
    const memory = seed();
    const listChildren = vi.spyOn(memory.api, "listChildren");
    renderWith(<PageTree space={SPACE} canEdit api={memory.api} />);

    expect(await screen.findByRole("tree", { name: "Các trang trong Design" })).toBeTruthy();
    expect(itemNames()).toEqual(["📘Hướng dẫn", "Chính sách", "Chưa có tiêu đề"]);
    expect(listChildren).toHaveBeenCalledTimes(1);
    expect(item(/Hướng dẫn/).getAttribute("aria-expanded")).toBe("false");
    expect(item(/Hướng dẫn/).getAttribute("href")).toBe("/s/design/p/huong-dan-p0000001");

    item(/Hướng dẫn/).focus();
    await userEvent.keyboard("{ArrowRight}");
    await screen.findByRole("treeitem", { name: "Nghỉ phép" });
    expect(listChildren).toHaveBeenCalledTimes(2);
    expect(listChildren).toHaveBeenLastCalledWith({ spaceId: SPACE.id, parentId: "guide" });
    expect(item("Nghỉ phép").getAttribute("aria-level")).toBe("2");
    expect(item("Nghỉ phép").getAttribute("aria-posinset")).toBe("1");
    expect(item("Nghỉ phép").getAttribute("aria-setsize")).toBe("2");
  });

  it("remembers expanded pages per Space across remounts", async () => {
    const memory = seed();
    const first = renderWith(<PageTree space={SPACE} canEdit api={memory.api} />);
    await screen.findByRole("tree");
    item(/Hướng dẫn/).focus();
    await userEvent.keyboard("{ArrowRight}");
    await screen.findByRole("treeitem", { name: "Nghỉ phép" });
    first.unmount();

    renderWith(<PageTree space={SPACE} canEdit api={memory.api} />);
    expect(await screen.findByRole("treeitem", { name: "Nghỉ phép" })).toBeTruthy();
    expect(item(/Hướng dẫn/).getAttribute("aria-expanded")).toBe("true");
  });

  it("follows the WAI-ARIA tree keyboard pattern with a roving tabindex", async () => {
    renderWith(<PageTree space={SPACE} canEdit api={seed().api} />);
    await screen.findByRole("tree");
    expect(item(/Hướng dẫn/).tabIndex).toBe(0);
    expect(item("Chính sách").tabIndex).toBe(-1);

    item(/Hướng dẫn/).focus();
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(document.activeElement).toBe(item("Chính sách")));
    expect(item("Chính sách").tabIndex).toBe(0);
    await userEvent.keyboard("{End}");
    await waitFor(() => expect(document.activeElement).toBe(item("Chưa có tiêu đề")));
    await userEvent.keyboard("{Home}");
    await waitFor(() => expect(document.activeElement).toBe(item(/Hướng dẫn/)));
    // Expand, go into the first child, back to the parent, collapse.
    await userEvent.keyboard("{ArrowRight}");
    await screen.findByRole("treeitem", { name: "Nghỉ phép" });
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => expect(document.activeElement).toBe(item("Nghỉ phép")));
    await userEvent.keyboard("{ArrowLeft}");
    await waitFor(() => expect(document.activeElement).toBe(item(/Hướng dẫn/)));
    await userEvent.keyboard("{ArrowLeft}");
    expect(item(/Hướng dẫn/).getAttribute("aria-expanded")).toBe("false");
    // Type-ahead.
    await userEvent.keyboard("c");
    await waitFor(() => expect(document.activeElement).toBe(item("Chính sách")));
  });

  it("marks the page open in the main area", async () => {
    pathname = "/s/design/p/chinh-sach-p0000004";
    renderWith(<PageTree space={SPACE} canEdit={false} api={seed().api} />);
    await screen.findByRole("tree");
    expect(item("Chính sách").getAttribute("aria-current")).toBe("page");
    expect(item("Chính sách").tabIndex).toBe(0);
  });

  it("reorders and nests with Alt+Shift+arrows and keeps the order on the server", async () => {
    const memory = seed();
    renderWith(<PageTree space={SPACE} canEdit api={memory.api} />);
    await screen.findByRole("tree");

    item("Chính sách").focus();
    await userEvent.keyboard("{Alt>}{Shift>}{ArrowUp}{/Shift}{/Alt}");
    await waitFor(() => expect(memory.titles(null)).toEqual(["Chính sách", "Hướng dẫn", ""]));
    expect(itemNames()).toEqual(["Chính sách", "📘Hướng dẫn", "Chưa có tiêu đề"]);
    expect(await screen.findByText("Đã di chuyển trang Chính sách.")).toBeTruthy();

    // Nest the untitled page under "Hướng dẫn" (children not loaded yet → appended last).
    item("Chưa có tiêu đề").focus();
    await userEvent.keyboard("{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}");
    await waitFor(() => expect(memory.titles("guide")).toEqual(["Nghỉ phép", "Onboarding", ""]));
    expect(await screen.findByRole("treeitem", { name: "Chưa có tiêu đề" })).toBeTruthy();
    expect(item("Chưa có tiêu đề").getAttribute("aria-level")).toBe("2");
  });

  it("rolls a refused move back and shows the translated error", async () => {
    const memory = seed();
    memory.failNext("move", "FORBIDDEN");
    renderWith(<PageTree space={SPACE} canEdit api={memory.api} />, "en");
    await screen.findByRole("tree");

    item("Chính sách").focus();
    await userEvent.keyboard("{Alt>}{Shift>}{ArrowUp}{/Shift}{/Alt}");
    expect((await screen.findByRole("alert")).textContent).toContain(enErrors.FORBIDDEN);
    expect(itemNames()).toEqual(["📘Hướng dẫn", "Chính sách", "Untitled"]);
    expect(memory.titles(null)).toEqual(["Hướng dẫn", "Chính sách", ""]);

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renames inline with F2 and cancels with Escape", async () => {
    const memory = seed();
    renderWith(<PageTree space={SPACE} canEdit api={memory.api} />);
    await screen.findByRole("tree");

    item("Chính sách").focus();
    await userEvent.keyboard("{F2}");
    const input = screen.getByRole("textbox", { name: "Tên trang" });
    await userEvent.clear(input);
    await userEvent.type(input, "Quy định{Enter}");
    expect(await screen.findByRole("treeitem", { name: "Quy định" })).toBeTruthy();
    await waitFor(() => expect(memory.page("policy")?.slug).toBe("quy-dinh"));
    expect(item("Quy định").getAttribute("href")).toBe("/s/design/p/quy-dinh-p0000004");

    item("Quy định").focus();
    await userEvent.keyboard("{F2}");
    await userEvent.type(screen.getByRole("textbox", { name: "Tên trang" }), "xx{Escape}");
    expect(item("Quy định")).toBeTruthy();
    expect(memory.page("policy")?.title).toBe("Quy định");
  });

  it("opens the actions menu from the keyboard; moves to trash and adds subpages", async () => {
    const memory = seed();
    renderWith(<PageTree space={SPACE} canEdit api={memory.api} />);
    await screen.findByRole("tree");

    item("Chính sách").focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    const menu = await screen.findByRole("menu");
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Chuyển vào thùng rác" }));
    await waitFor(() => expect(memory.titles(null)).toEqual(["Hướng dẫn", ""]));
    expect(within(tree()).queryByRole("treeitem", { name: "Chính sách" })).toBeNull();

    item(/Hướng dẫn/).focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Thêm trang con" }));
    const input = await screen.findByRole("textbox", { name: "Tên trang" });
    await userEvent.type(input, "Quy trình{Enter}");
    await waitFor(() =>
      expect(memory.titles("guide")).toEqual(["Nghỉ phép", "Onboarding", "Quy trình"]),
    );
    expect(item("Quy trình").getAttribute("aria-level")).toBe("2");
  });

  it("goes back to the Space home when the open page is trashed", async () => {
    pathname = "/s/design/p/chinh-sach-p0000004";
    renderWith(<PageTree space={SPACE} canEdit api={seed().api} />);
    await screen.findByRole("tree");
    item("Chính sách").focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Chuyển vào thùng rác" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/s/design"));
  });

  it("offers only read actions to viewers", async () => {
    renderWith(<PageTree space={SPACE} canEdit={false} api={seed().api} />, "en");
    await screen.findByRole("tree");
    expect(screen.queryByRole("button", { name: "New page" })).toBeNull();
    item("Chính sách").focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((el) => el.textContent),
    ).toEqual(["Copy link"]);
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{F2}");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("creates a root page and shows an empty state", async () => {
    const memory = createMemoryPageTreeApi(SPACE.id, []);
    renderWith(<PageTree space={SPACE} canEdit api={memory.api} />, "en");
    expect(await screen.findByText("No pages yet.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "New page" }));
    const input = await screen.findByRole("textbox", { name: "Page title" });
    await act(() => userEvent.type(input, "Roadmap{Enter}"));
    await waitFor(() => expect(memory.titles(null)).toEqual(["Roadmap"]));
  });

  it("shows a translated error when a level cannot be loaded", async () => {
    const memory = seed();
    memory.failNext("listChildren", "PAGE_ACTION_FAILED");
    renderWith(<PageTree space={SPACE} canEdit api={memory.api} />);
    expect((await screen.findByRole("alert")).textContent).toContain(viErrors.PAGE_ACTION_FAILED);
  });
});

describe("PageBreadcrumb", () => {
  const crumb = (id: string, title: string) => ({
    id,
    title,
    icon: null,
    slug: title.toLowerCase(),
    shortId: `${id}0000000`.slice(0, 8),
  });

  it("links the Space and ancestors and marks the current page", () => {
    renderWith(
      <PageBreadcrumb
        space={SPACE}
        ancestors={[crumb("a", "Guide"), crumb("b", "")]}
        page={{ title: "Leave", icon: "🌴" }}
      />,
      "en",
    );
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Design", "/s/design"],
      ["Guide", "/s/design/p/guide-a0000000"],
      ["Untitled", "/s/design/p/b0000000"],
      ["🌴Leave", null],
    ]);
    expect(links.at(-1)!.getAttribute("aria-current")).toBe("page");
  });

  it("collapses long chains", () => {
    expect(visibleCrumbs([1, 2, 3], 3)).toEqual({ head: [1, 2, 3], collapsed: false, tail: [] });
    expect(visibleCrumbs([1, 2, 3, 4, 5], 3)).toEqual({ head: [1], collapsed: true, tail: [4, 5] });
  });
});
