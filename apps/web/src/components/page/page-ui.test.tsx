// @vitest-environment happy-dom
import enCommon from "@kb/i18n/messages/en/common.json";
import enErrors from "@kb/i18n/messages/en/errors.json";
import enTree from "@kb/i18n/messages/en/tree.json";
import viCommon from "@kb/i18n/messages/vi/common.json";
import viErrors from "@kb/i18n/messages/vi/errors.json";
import viTree from "@kb/i18n/messages/vi/tree.json";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PageSummary } from "@/server/pages";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/",
  useParams: () => ({ spaceSlug: "design" }),
}));

const actions = vi.hoisted(() => ({
  renamePageAction: vi.fn(),
  setPageIconAction: vi.fn(),
  restorePageAction: vi.fn(),
  purgePageAction: vi.fn(),
  trashPageAction: vi.fn(),
}));
vi.mock("@/server/pages/actions", () => actions);

// The read-only editor itself is covered by the editor tests.
vi.mock("@/components/editor/block-editor", () => ({
  BlockEditor: () => <div data-testid="block-editor" />,
}));
vi.mock("@/components/editor/CollabEditor", () => ({
  CollabEditor: ({ editing }: { editing: boolean }) => (
    <div data-testid="collab-editor" data-editing={String(editing)} />
  ),
}));

const collab = { url: "wss://collab.test", schemaVersion: 1 };

const { PageView } = await import("./page-view");
const { TrashList } = await import("./trash-list");
const { isEmptyDocument } = await import("./page-content");
const { normalizeTitle } = await import("./page-title");

const messages = {
  vi: { common: viCommon, errors: viErrors, tree: viTree },
  en: { common: enCommon, errors: enErrors, tree: enTree },
};

function renderWith(ui: ReactNode, locale: "vi" | "en" = "vi") {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Asia/Ho_Chi_Minh">
      {ui}
    </NextIntlClientProvider>,
  );
}

function makePage(overrides: Partial<PageSummary> = {}): PageSummary {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    spaceId: "0b9a0000-0000-4000-8000-000000000001",
    parentId: null,
    shortId: "a1B2c3D4",
    slug: "huong-dan",
    title: "Hướng dẫn",
    icon: "📘",
    position: "V",
    lastEditedAt: "2026-09-26T09:00:00+00:00",
    deletedAt: null,
    ...overrides,
  };
}

const doc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
};

beforeEach(() => vi.clearAllMocks());

/** Pages open for reading: "Edit" unlocks the title, icon and body. */
async function startEditing(user: ReturnType<typeof userEvent.setup>, locale: "vi" | "en" = "vi") {
  const tree = locale === "vi" ? viTree : enTree;
  await user.click(screen.getByRole("button", { name: tree.page.mode.editLabel }));
}
afterEach(cleanup);

describe("helpers", () => {
  it("normalizes titles like the server", () => {
    expect(normalizeTitle("  Quy   trình\tmới ")).toBe("Quy trình mới");
  });

  it("detects empty documents", () => {
    expect(isEmptyDocument({ type: "doc", content: [] })).toBe(true);
    expect(isEmptyDocument({ type: "doc", content: [{ type: "paragraph" }] })).toBe(true);
    expect(isEmptyDocument(doc)).toBe(false);
  });
});

describe("PageView", () => {
  it("opens for reading; Edit unlocks title, icon and body, Done locks them again", async () => {
    const user = userEvent.setup();
    renderWith(
      <PageView page={makePage()} spaceSlug="design" canEdit content={doc} collab={collab} />,
    );
    expect(screen.queryByRole("textbox", { name: "Tiêu đề trang" })).toBeNull();
    expect(screen.queryByRole("button", { name: viTree.page.icon.change })).toBeNull();
    expect(screen.getByTestId("collab-editor").dataset.editing).toBe("false");

    await startEditing(user);
    expect(screen.getByRole("textbox", { name: "Tiêu đề trang" })).toBeTruthy();
    expect(screen.getByRole("button", { name: viTree.page.icon.change })).toBeTruthy();
    expect(screen.getByTestId("collab-editor").dataset.editing).toBe("true");

    await user.click(screen.getByRole("button", { name: viTree.page.mode.doneLabel }));
    expect(screen.queryByRole("textbox", { name: "Tiêu đề trang" })).toBeNull();
    expect(screen.getByTestId("collab-editor").dataset.editing).toBe("false");
    expect(screen.getByRole("button", { name: viTree.page.mode.editLabel })).toBeTruthy();
  });

  it("opens a new, empty page for editing", () => {
    renderWith(
      <PageView page={makePage()} spaceSlug="design" canEdit content={null} collab={collab} />,
    );
    expect(screen.getByTestId("collab-editor").dataset.editing).toBe("true");
    expect(screen.getByRole("button", { name: viTree.page.mode.doneLabel })).toBeTruthy();
  });

  it("renames on Enter and replaces the URL with the new slug", async () => {
    const user = userEvent.setup();
    actions.renamePageAction.mockResolvedValue({
      ok: true,
      data: makePage({ title: "Hướng dẫn mới", slug: "huong-dan-moi" }),
    });
    renderWith(<PageView page={makePage()} spaceSlug="design" canEdit content={doc} />);
    await startEditing(user);

    const title = screen.getByRole("textbox", { name: "Tiêu đề trang" });
    await user.clear(title);
    await user.type(title, "  Hướng dẫn   mới {Enter}");

    expect(actions.renamePageAction).toHaveBeenCalledWith({
      pageId: makePage().id,
      title: "Hướng dẫn mới",
    });
    expect(router.replace).toHaveBeenCalledWith("/s/design/p/huong-dan-moi-a1B2c3D4", {
      scroll: false,
    });
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.getByTestId("block-editor")).toBeTruthy();
  });

  it("restores the saved title on Escape without saving", async () => {
    const user = userEvent.setup();
    renderWith(<PageView page={makePage()} spaceSlug="design" canEdit content={doc} />);
    await startEditing(user);
    const title = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Tiêu đề trang" });
    await user.type(title, " x{Escape}");
    expect(title.value).toBe("Hướng dẫn");
    expect(actions.renamePageAction).not.toHaveBeenCalled();
  });

  it("shows a translated error when the rename fails", async () => {
    const user = userEvent.setup();
    actions.renamePageAction.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    renderWith(<PageView page={makePage()} spaceSlug="design" canEdit content={doc} />, "en");
    await startEditing(user, "en");
    const title = screen.getByRole("textbox", { name: "Page title" });
    await user.type(title, "!{Enter}");
    expect((await screen.findByRole("alert")).textContent).toBe(enErrors.FORBIDDEN);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("changes and removes the icon through setPageIconAction", async () => {
    const user = userEvent.setup();
    actions.setPageIconAction.mockResolvedValue({ ok: true, data: makePage({ icon: "🚀" }) });
    renderWith(<PageView page={makePage()} spaceSlug="design" canEdit content={doc} />, "en");
    await startEditing(user, "en");

    await user.click(screen.getByRole("button", { name: "Change icon" }));
    await user.click(screen.getByRole("button", { name: "🚀" }));
    expect(actions.setPageIconAction).toHaveBeenCalledWith({ pageId: makePage().id, icon: "🚀" });

    actions.setPageIconAction.mockResolvedValue({ ok: true, data: makePage({ icon: null }) });
    await user.click(screen.getByRole("button", { name: "Change icon" }));
    await user.click(screen.getByRole("button", { name: "Remove icon" }));
    expect(actions.setPageIconAction).toHaveBeenLastCalledWith({
      pageId: makePage().id,
      icon: null,
    });
    expect(await screen.findByRole("button", { name: "Add icon" })).toBeTruthy();
  });

  it("moves the page to the trash from the page menu", async () => {
    const user = userEvent.setup();
    actions.trashPageAction.mockResolvedValue({ ok: true, data: makePage() });
    renderWith(<PageView page={makePage()} spaceSlug="design" canEdit content={doc} />, "en");
    await user.click(screen.getByRole("button", { name: enTree.page.menu }));
    await user.click(await screen.findByRole("menuitem", { name: enTree.actions.moveToTrash }));
    expect(actions.trashPageAction).toHaveBeenCalledWith({ pageId: makePage().id });
    expect(router.refresh).toHaveBeenCalled();
  });

  it("is read-only for viewers, with the untitled placeholder and the empty-content notice", () => {
    renderWith(
      <PageView
        page={makePage({ title: "", icon: null })}
        spaceSlug="design"
        canEdit={false}
        content={null}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(viTree.untitled);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(viTree.page.content.empty)).toBeTruthy();
  });

  it("shows the trashed notice with restore, and locks the title", async () => {
    const user = userEvent.setup();
    actions.restorePageAction.mockResolvedValue({ ok: true, data: makePage() });
    renderWith(
      <PageView
        page={makePage({ deletedAt: "2026-09-27T09:00:00+00:00" })}
        spaceSlug="design"
        canEdit
        content={doc}
      />,
      "en",
    );
    const notice = screen.getByRole("region", { name: enTree.page.trashed.title });
    expect(
      within(notice)
        .getByRole("link", { name: enTree.page.trashed.openTrash })
        .getAttribute("href"),
    ).toBe("/s/design/trash");
    expect(screen.queryByRole("textbox", { name: "Page title" })).toBeNull();
    await user.click(within(notice).getByRole("button", { name: enTree.trash.restore }));
    expect(actions.restorePageAction).toHaveBeenCalledWith({ pageId: makePage().id });
    expect(router.refresh).toHaveBeenCalled();
  });
});

describe("TrashList", () => {
  const deletedAt = "2026-09-27T09:00:00+00:00";
  const parent = makePage({ deletedAt });
  const child = makePage({
    id: "20000000-0000-4000-8000-000000000002",
    parentId: parent.id,
    shortId: "b1B2c3D4",
    slug: "con",
    title: "Con",
    deletedAt,
  });

  it("lists trashed pages with subpages folded in and links to them", () => {
    renderWith(<TrashList spaceSlug="design" pages={[parent, child]} canPurge />, "en");
    const list = screen.getByRole("list", { name: enTree.trash.listLabel });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(within(items[0]!).getByRole("link", { name: "Hướng dẫn" }).getAttribute("href")).toBe(
      "/s/design/p/huong-dan-a1B2c3D4",
    );
    expect(within(items[0]!).getByText(/With 1 subpage/)).toBeTruthy();
  });

  it("restores a page and offers a link to it", async () => {
    const user = userEvent.setup();
    actions.restorePageAction.mockResolvedValue({ ok: true, data: makePage() });
    renderWith(<TrashList spaceSlug="design" pages={[parent]} canPurge={false} />);
    await user.click(screen.getByRole("button", { name: "Khôi phục “Hướng dẫn”" }));
    expect(actions.restorePageAction).toHaveBeenCalledWith({ pageId: parent.id });
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Đã khôi phục “Hướng dẫn”.");
    expect(within(status).getByRole("link").getAttribute("href")).toBe(
      "/s/design/p/huong-dan-a1B2c3D4",
    );
    expect(router.refresh).toHaveBeenCalled();
  });

  it("hides permanent deletion from non-admins", () => {
    renderWith(<TrashList spaceSlug="design" pages={[parent]} canPurge={false} />);
    expect(screen.queryByRole("button", { name: /Xoá vĩnh viễn/ })).toBeNull();
  });

  it("deletes permanently only after confirming", async () => {
    const user = userEvent.setup();
    actions.purgePageAction.mockResolvedValue({ ok: true, data: null });
    renderWith(<TrashList spaceSlug="design" pages={[parent, child]} canPurge />, "en");

    await user.click(screen.getByRole("button", { name: "Delete “Hướng dẫn” permanently" }));
    const dialog = screen.getByRole("alertdialog", { name: enTree.trash.purgeConfirmTitle });
    expect(dialog.textContent).toContain("“Hướng dẫn” and 1 subpage will be deleted permanently.");
    await user.click(within(dialog).getByRole("button", { name: enCommon.actions.cancel }));
    expect(actions.purgePageAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete “Hướng dẫn” permanently" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: enTree.trash.purge }),
    );
    expect(actions.purgePageAction).toHaveBeenCalledWith({ pageId: parent.id });
    expect((await screen.findByRole("status")).textContent).toBe(
      "“Hướng dẫn” was deleted permanently.",
    );
  });

  it("shows translated errors and the empty state", async () => {
    const user = userEvent.setup();
    actions.restorePageAction.mockResolvedValue({ ok: false, code: "PAGE_PARENT_DELETED" });
    const { unmount } = renderWith(<TrashList spaceSlug="design" pages={[parent]} canPurge />);
    await user.click(screen.getByRole("button", { name: "Khôi phục “Hướng dẫn”" }));
    expect((await screen.findByRole("alert")).textContent).toBe(viErrors.PAGE_PARENT_DELETED);
    unmount();

    renderWith(<TrashList spaceSlug="design" pages={[]} canPurge />, "en");
    expect(screen.getByText(enTree.trash.empty)).toBeTruthy();
  });
});
