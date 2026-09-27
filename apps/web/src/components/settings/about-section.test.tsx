// @vitest-environment happy-dom
import enSettings from "@kb/i18n/messages/en/settings.json";
import viSettings from "@kb/i18n/messages/vi/settings.json";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import type { AboutInfo } from "@/server/release";

import { AboutSection } from "./about-section";

afterEach(cleanup);

const ABOUT: AboutInfo = {
  version: "0.1.0",
  sha: "3f2c9e1aa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5",
  env: "staging",
  collab: { version: "0.1.0", sha: "3f2c9e1aa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5", schemaVersion: 1 },
};

function renderAbout(locale: "vi" | "en", about: AboutInfo) {
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ settings: locale === "vi" ? viSettings : enSettings }}
    >
      <AboutSection about={about} />
    </NextIntlClientProvider>,
  );
}

describe("AboutSection", () => {
  it("shows the web and collab versions, the short commit and the environment", () => {
    renderAbout("vi", ABOUT);
    expect(screen.getByRole("heading", { name: "Giới thiệu" })).toBeTruthy();
    expect(screen.getByText("Phiên bản 0.1.0")).toBeTruthy();
    const commit = screen.getByText("3f2c9e1");
    expect(commit.getAttribute("title")).toBe(ABOUT.sha);
    expect(screen.getByText("Thử nghiệm (staging)")).toBeTruthy();
    expect(screen.getByText("0.1.0 · schema editor 1")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Xem có gì mới" }).getAttribute("href")).toBe(
      "/whats-new",
    );
  });

  it("says when collab is unavailable and keeps a non-hex sha as is", () => {
    renderAbout("en", { ...ABOUT, sha: "unknown", env: "local", collab: null });
    expect(screen.getByText("unknown")).toBeTruthy();
    expect(screen.getByText("Local development")).toBeTruthy();
    expect(screen.getByText("Unavailable")).toBeTruthy();
  });
});
