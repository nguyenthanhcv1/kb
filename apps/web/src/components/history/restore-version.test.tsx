// @vitest-environment happy-dom
import enEditor from "@kb/i18n/messages/en/editor.json";
import enErrors from "@kb/i18n/messages/en/errors.json";
import enHistory from "@kb/i18n/messages/en/history.json";
import enTree from "@kb/i18n/messages/en/tree.json";
import viEditor from "@kb/i18n/messages/vi/editor.json";
import viErrors from "@kb/i18n/messages/vi/errors.json";
import viHistory from "@kb/i18n/messages/vi/history.json";
import viTree from "@kb/i18n/messages/vi/tree.json";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formats } from "@kb/i18n";

import { DocumentReplacedToast } from "@/components/editor/document-replaced-toast";
import type { PageVersionDetail, PageVersionSummary } from "@/server/versions";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/server/versions/actions", () => ({ restorePageVersionAction: vi.fn() }));
vi.mock("@/components/editor/block-editor", () => ({
  BlockEditor: () => <div data-testid="preview" />,
}));

const { HistoryView } = await import("./history-view");

const messages = {
  vi: { history: viHistory, tree: viTree, errors: viErrors, editor: viEditor },
  en: { history: enHistory, tree: enTree, errors: enErrors, editor: enEditor },
};

function renderWith(ui: ReactNode, locale: "vi" | "en" = "en") {
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

const v = (no: number, extra: Partial<PageVersionSummary> = {}): PageVersionSummary => ({
  id: `00000000-0000-4000-8000-00000000000${no}`,
  versionNo: no,
  title: "Trang",
  reason: "auto",
  label: null,
  restoredFromVersionNo: null,
  createdAt: "2026-09-28T17:30:00+00:00",
  createdBy: { id: "u1", name: "Nguyễn A", email: null },
  ...extra,
});
const versions = [v(2, { reason: "manual", label: "Approved" }), v(1)];
const selected: PageVersionDetail = {
  ...versions[0]!,
  contentJson: { type: "doc", content: [] },
  schemaVersion: 1,
};
const base = {
  pageId: "7b0c2a4e-1f5d-4c3b-9a8e-2d6f1b3c5a7e",
  pageHref: "/s/a/p/b-12345678",
  historyHref: "/s/a/p/b-12345678/history",
  pageTitle: "Trang",
  versions,
  selected,
  mode: "preview" as const,
  against: "previous" as const,
  compareWith: null,
};

beforeEach(() => router.refresh.mockReset());
afterEach(cleanup);

describe("restore from the history", () => {
  it("hides the button from viewers", () => {
    renderWith(<HistoryView {...base} canRestore={false} />);
    expect(screen.queryByRole("button", { name: enHistory.restore })).toBeNull();
  });

  it("asks for confirmation, restores and links to the undo version", async () => {
    const user = userEvent.setup();
    const restore = vi.fn().mockResolvedValue({
      ok: true,
      data: { versionNo: 6, restoredFromVersionNo: 2, preRestoreVersionNo: 5 },
    });
    renderWith(<HistoryView {...base} canRestore restore={restore} />);

    await user.click(screen.getByRole("button", { name: enHistory.restore }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Restore "Approved"\?/)).toBeTruthy();
    expect(restore).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: enHistory.restoreDialog.confirm }));
    await waitFor(() =>
      expect(restore).toHaveBeenCalledWith({ pageId: base.pageId, versionId: selected.id }),
    );

    const status = await screen.findByRole("status");
    expect(within(status).getByText(enHistory.restoreDone.title)).toBeTruthy();
    expect(
      within(status)
        .getByRole("link", { name: enHistory.restoreDone.viewPrevious })
        .getAttribute("href"),
    ).toBe("/s/a/p/b-12345678/history?v=5");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("keeps the dialog open and shows the translated error (viewer refused by collab)", async () => {
    const user = userEvent.setup();
    const restore = vi.fn().mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    renderWith(<HistoryView {...base} canRestore restore={restore} />, "vi");

    await user.click(screen.getByRole("button", { name: viHistory.restore }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: viHistory.restoreDialog.confirm }));

    expect((await within(dialog).findByRole("alert")).textContent).toBe(viErrors.FORBIDDEN);
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe("DocumentReplacedToast", () => {
  it("explains the restore, links to the history and can be dismissed", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    renderWith(<DocumentReplacedToast reason="restore" historyHref="/h" onDismiss={onDismiss} />);
    const toast = screen.getByRole("status");
    expect(within(toast).getByText(enEditor.collab.replaced.restore.title)).toBeTruthy();
    expect(
      within(toast)
        .getByRole("link", { name: enEditor.collab.replaced.openHistory })
        .getAttribute("href"),
    ).toBe("/h");
    await user.click(within(toast).getByRole("button", { name: enEditor.collab.replaced.dismiss }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("hides itself after the delay", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    renderWith(<DocumentReplacedToast reason="template" onDismiss={onDismiss} durationMs={500} />);
    expect(screen.queryByRole("link")).toBeNull();
    vi.advanceTimersByTime(600);
    expect(onDismiss).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
