// @vitest-environment happy-dom
import enWhatsNew from "@kb/i18n/messages/en/whatsNew.json";
import viWhatsNew from "@kb/i18n/messages/vi/whatsNew.json";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import type { ReleaseNotes } from "@/server/release";

import { WhatsNewList } from "./whats-new-list";

afterEach(cleanup);

function renderList(locale: "vi" | "en", releases: ReleaseNotes[]) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      timeZone="Asia/Ho_Chi_Minh"
      messages={{ whatsNew: locale === "vi" ? viWhatsNew : enWhatsNew }}
    >
      <WhatsNewList releases={releases} />
    </NextIntlClientProvider>,
  );
}

const RELEASES: ReleaseNotes[] = [
  {
    version: "0.2.0",
    date: "2026-10-12",
    markdown: "### Thêm\n\n- Tạo **Space** mới\n- Xem [hướng dẫn](https://example.com/guide)",
    language: "vi",
    isFallback: false,
  },
  {
    version: "0.1.0",
    date: "2026-09-30",
    markdown: "### Added\n\n* Sign in with Google <script>alert(1)</script>",
    language: "en",
    isFallback: true,
  },
];

describe("WhatsNewList", () => {
  it("lists versions newest first with the release date and rendered markdown", () => {
    renderList("vi", RELEASES);
    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(2);

    const latest = within(articles[0]!);
    expect(latest.getByRole("heading", { level: 2, name: "Phiên bản 0.2.0" })).toBeTruthy();
    expect(latest.getByText("Phát hành ngày 12 tháng 10, 2026")).toBeTruthy();
    expect(latest.getByRole("heading", { level: 3, name: "Thêm" })).toBeTruthy();
    expect(latest.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Tạo Space mới",
      "Xem hướng dẫn",
    ]);
    expect(latest.getByRole("link", { name: "hướng dẫn" }).getAttribute("href")).toBe(
      "https://example.com/guide",
    );
    expect(latest.queryByText(viWhatsNew.englishOnly)).toBeNull();
  });

  it("labels English notes shown to a Vietnamese reader and never renders raw HTML", () => {
    const { container } = renderList("vi", RELEASES);
    const old = within(screen.getAllByRole("article")[1]!);
    expect(old.getByText(viWhatsNew.englishOnly)).toBeTruthy();
    expect(container.querySelector('[lang="en"]')?.textContent).toContain("Sign in with Google");
    expect(container.querySelector("script")).toBeNull();
  });

  it("uses the English labels and date format in English", () => {
    renderList("en", [{ ...RELEASES[1]!, isFallback: false }]);
    expect(screen.getByRole("heading", { level: 2, name: "Version 0.1.0" })).toBeTruthy();
    expect(screen.getByText("Released on September 30, 2026")).toBeTruthy();
    expect(screen.queryByText(enWhatsNew.englishOnly)).toBeNull();
  });

  it("shows an empty state before the first release and a note for releases without notes", () => {
    renderList("en", []);
    expect(screen.getByText(enWhatsNew.empty)).toBeTruthy();
    cleanup();
    renderList("en", [{ ...RELEASES[1]!, markdown: "", isFallback: false }]);
    expect(screen.getByText(enWhatsNew.noNotes)).toBeTruthy();
  });

  it("marks only the newest version as latest", () => {
    renderList("vi", RELEASES);
    const articles = screen.getAllByRole("article");
    expect(within(articles[0]!).getByText(viWhatsNew.latest)).toBeTruthy();
    expect(within(articles[1]!).queryByText(viWhatsNew.latest)).toBeNull();
  });

  it("filters the notes to one kind of change and hides versions without it", async () => {
    const user = userEvent.setup();
    renderList("en", [
      {
        version: "0.2.0",
        date: "2026-10-12",
        markdown: "### Added\n\n- New space\n\n### Fixed\n\n- Login loop",
        language: "en",
        isFallback: false,
      },
      {
        version: "0.1.0",
        date: "2026-09-30",
        markdown: "### Added\n\n- First release",
        language: "en",
        isFallback: false,
      },
    ]);
    const group = screen.getByRole("group", { name: enWhatsNew.filterLabel });
    expect(
      within(group).getByRole("button", { name: enWhatsNew.all }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getAllByRole("article")).toHaveLength(2);

    await user.click(within(group).getByRole("button", { name: enWhatsNew.fixes }));
    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(1);
    expect(within(articles[0]!).getByText("Login loop")).toBeTruthy();
    expect(within(articles[0]!).queryByText("New space")).toBeNull();

    await user.click(within(group).getByRole("button", { name: enWhatsNew.improvements }));
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.getByText(enWhatsNew.noMatch)).toBeTruthy();

    await user.click(within(group).getByRole("button", { name: enWhatsNew.all }));
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });
});
