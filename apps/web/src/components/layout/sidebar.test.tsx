// @vitest-environment happy-dom
import enCommon from "@kb/i18n/messages/en/common.json";
import viCommon from "@kb/i18n/messages/vi/common.json";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import { Sidebar } from "./sidebar";

afterEach(cleanup);

function renderSidebar(locale: "vi" | "en", version?: string) {
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ common: locale === "vi" ? viCommon : enCommon }}
    >
      <Sidebar version={version} />
    </NextIntlClientProvider>,
  );
}

describe("Sidebar footer", () => {
  it("shows the running version linking to What's new", () => {
    renderSidebar("vi", "0.1.0");
    const link = screen.getByRole("link", { name: "Phiên bản 0.1.0 — xem có gì mới" });
    expect(link.textContent).toBe("v0.1.0");
    expect(link.getAttribute("href")).toBe("/whats-new");
  });

  it("has no footer without a version", () => {
    renderSidebar("en");
    expect(screen.queryByRole("link", { name: /Version/ })).toBeNull();
  });
});
