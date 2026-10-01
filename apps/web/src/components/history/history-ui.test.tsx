// @vitest-environment happy-dom
import enHistory from "@kb/i18n/messages/en/history.json";
import enTree from "@kb/i18n/messages/en/tree.json";
import viHistory from "@kb/i18n/messages/vi/history.json";
import viTree from "@kb/i18n/messages/vi/tree.json";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formats } from "@kb/i18n";

import type { PageVersionDetail, PageVersionSummary } from "@/server/versions";

vi.mock("@/components/editor/block-editor", () => ({
  BlockEditor: () => <div data-testid="preview" />,
}));

const { HistoryView, versionHref } = await import("./history-view");

const messages = {
  vi: { history: viHistory, tree: viTree },
  en: { history: enHistory, tree: enTree },
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

const doc = (...texts: string[]) => ({
  type: "doc",
  content: texts.map((text, i) => ({
    type: "paragraph",
    attrs: { id: `b${i}` },
    content: [{ type: "text", text }],
  })),
});

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

const versions = [v(2, { reason: "manual", label: "Bản duyệt" }), v(1)];
const selected: PageVersionDetail = {
  ...versions[0]!,
  contentJson: doc("Xin chào các bạn"),
  schemaVersion: 1,
};

const base = {
  pageId: "7b0c2a4e-1f5d-4c3b-9a8e-2d6f1b3c5a7e",
  pageHref: "/s/a/p/b-12345678",
  historyHref: "/s/a/p/b-12345678/history",
  pageTitle: "Trang",
  versions,
  selected,
  against: "previous" as const,
};

afterEach(cleanup);

describe("HistoryView", () => {
  it("lists versions with author, VN-time and reason; marks the selected one", () => {
    renderWith(<HistoryView {...base} mode="preview" compareWith={null} />);
    expect(screen.getAllByText("Bản duyệt").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Nguyễn A").length).toBe(2);
    // 17:30 UTC on 28/09 is 00:30 on 29/09 in Asia/Ho_Chi_Minh.
    expect(screen.getAllByText(/00:30 29\/09\/2026/).length).toBeGreaterThan(0);
    const current = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current"));
    expect(current.some((a) => a.getAttribute("href")?.includes("v=2"))).toBe(true);
    expect(screen.getByTestId("preview")).toBeTruthy();
  });

  it("shows a block diff in English", () => {
    renderWith(<HistoryView {...base} mode="diff" compareWith={doc("Xin chào bạn")} />, "en");
    expect(screen.getByText(/1 block changed/)).toBeTruthy();
    expect(screen.getByText(/Against previous version/)).toBeTruthy();
  });

  it("explains an empty history", () => {
    renderWith(
      <HistoryView {...base} versions={[]} selected={null} mode="preview" compareWith={null} />,
    );
    expect(screen.getByText(viHistory.empty)).toBeTruthy();
  });
});

describe("versionHref", () => {
  it("keeps the mode in the URL", () => {
    expect(versionHref("/h", 3, "preview", "previous")).toBe("/h?v=3");
    expect(versionHref("/h", 3, "diff", "current")).toBe("/h?v=3&mode=diff&against=current");
  });
});
