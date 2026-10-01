// @vitest-environment happy-dom
import enEditor from "@kb/i18n/messages/en/editor.json";
import viEditor from "@kb/i18n/messages/vi/editor.json";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import type { CollabStatus } from "@/lib/collab/status";

import { CollabStatusIndicator } from "./collab-status";

afterEach(cleanup);

function show(status: CollabStatus, locale: "vi" | "en") {
  const editor = locale === "vi" ? viEditor : enEditor;
  render(
    <NextIntlClientProvider locale={locale} messages={{ editor }}>
      <CollabStatusIndicator status={status} />
    </NextIntlClientProvider>,
  );
}

describe("CollabStatusIndicator", () => {
  it.each([
    ["saved", "vi", "Đã lưu"],
    ["saved", "en", "Saved"],
    ["saving", "en", "Saving…"],
    ["offline", "vi", "Mất kết nối"],
  ] as const)("%s in %s", (status, locale, text) => {
    show(status, locale);
    expect(screen.getByRole("status").textContent).toContain(text);
  });

  it("offers a reload when the client is outdated", () => {
    show("outdated", "en");
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });
});
