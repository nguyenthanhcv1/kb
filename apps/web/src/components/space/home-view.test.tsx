// @vitest-environment happy-dom
import { formats } from "@kb/i18n";
import enCommon from "@kb/i18n/messages/en/common.json";
import enErrors from "@kb/i18n/messages/en/errors.json";
import enSpace from "@kb/i18n/messages/en/space.json";
import enTree from "@kb/i18n/messages/en/tree.json";
import viCommon from "@kb/i18n/messages/vi/common.json";
import viErrors from "@kb/i18n/messages/vi/errors.json";
import viSpace from "@kb/i18n/messages/vi/space.json";
import viTree from "@kb/i18n/messages/vi/tree.json";
import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RecentPage } from "@/server/pages";
import type { SpaceSummary } from "@/server/space";

const quickSwitcher = vi.hoisted(() => vi.fn());
vi.mock("@/components/search/quick-switcher", () => ({
  QuickSwitcher: (props: Record<string, unknown>) => {
    quickSwitcher(props);
    return <button type="button">hero-search</button>;
  },
}));
vi.mock("@/server/space/actions", () => ({ createSpace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { HomeView } = await import("./home-view");

afterEach(() => {
  cleanup();
  quickSwitcher.mockClear();
});

const messages = {
  vi: { common: viCommon, errors: viErrors, space: viSpace, tree: viTree },
  en: { common: enCommon, errors: enErrors, space: enSpace, tree: enTree },
};

function renderHome(
  props: { spaces: SpaceSummary[]; recent: RecentPage[]; canCreate: boolean },
  locale: "vi" | "en" = "vi",
) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={messages[locale]}
      formats={formats}
      timeZone="Asia/Ho_Chi_Minh"
    >
      <HomeView {...props} />
    </NextIntlClientProvider>,
  );
}

const space: SpaceSummary = {
  id: "0b9a0000-0000-4000-8000-000000000001",
  slug: "spe",
  name: "Shopee Express",
  description: "Quy trình Shopee Express",
  icon: "🛍️",
  visibility: "restricted",
  aiEnabled: true,
  createdBy: "5d2f0000-0000-4000-8000-000000000002",
  createdAt: "2026-09-01T02:00:00+00:00",
  updatedAt: "2026-09-01T02:00:00+00:00",
  role: "editor",
};

function recentPage(overrides: Partial<RecentPage> = {}): RecentPage {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    spaceId: space.id,
    parentId: null,
    shortId: "a1B2c3D4",
    slug: "quy-trinh-doi-soat",
    title: "Quy trình đối soát",
    icon: "📘",
    position: "V",
    lastEditedAt: "2026-10-08T07:30:00+00:00",
    deletedAt: null,
    spaceSlug: "spe",
    spaceName: "Shopee Express",
    spaceIcon: "🛍️",
    ...overrides,
  };
}

describe("HomeView", () => {
  it("shows the search hero, the Spaces and the recently updated pages", () => {
    renderHome({
      spaces: [space],
      recent: [recentPage(), recentPage({ id: "2", shortId: "b2C3d4E5", slug: "", title: "" })],
      canCreate: true,
    });

    expect(
      screen.getByRole("heading", { level: 1, name: viSpace.dashboard.heroTitle }),
    ).toBeTruthy();
    // The hero owns no Ctrl+K: the top bar's switcher does.
    expect(quickSwitcher).toHaveBeenCalledWith({ variant: "hero", globalShortcut: false });

    const spaces = screen.getByRole("region", { name: viSpace.dashboard.spacesTitle });
    expect(
      within(spaces)
        .getByRole("link", { name: /Shopee Express/ })
        .getAttribute("href"),
    ).toBe("/s/spe");
    expect(within(spaces).getByRole("button", { name: viSpace.create })).toBeTruthy();

    const recent = screen.getByRole("region", { name: viSpace.dashboard.recentTitle });
    const links = within(recent).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/s/spe/p/quy-trinh-doi-soat-a1B2c3D4",
      "/s/spe/p/b2C3d4E5",
    ]);
    expect(within(links[0]!).getByText("Quy trình đối soát")).toBeTruthy();
    expect(within(links[0]!).getByText(/^Cập nhật .*14:30/)).toBeTruthy();
    expect(within(links[1]!).getByText(viTree.untitled)).toBeTruthy();
  });

  it("explains an empty list of recent pages in English", () => {
    renderHome({ spaces: [space], recent: [], canCreate: false }, "en");
    expect(screen.getByText(enSpace.dashboard.recentEmpty)).toBeTruthy();
    expect(screen.queryByRole("button", { name: enSpace.create })).toBeNull();
  });

  it("without Spaces shows only the empty state, no recent list", () => {
    renderHome({ spaces: [], recent: [], canCreate: true });
    expect(screen.getByText(viSpace.list.empty)).toBeTruthy();
    expect(screen.queryByRole("region", { name: viSpace.dashboard.recentTitle })).toBeNull();
  });
});
