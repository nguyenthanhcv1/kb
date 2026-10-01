import { createRequire } from "node:module";

import type viAuth from "@kb/i18n/messages/vi/auth.json";
import type viCommon from "@kb/i18n/messages/vi/common.json";
import type viNav from "@kb/i18n/messages/vi/nav.json";
import type viSettings from "@kb/i18n/messages/vi/settings.json";
import type viWhatsNew from "@kb/i18n/messages/vi/whatsNew.json";
import { expect, test } from "@playwright/test";
import { useLocale } from "../support/locale";

/**
 * T0.6b — the running version in the sidebar footer leads to What's new; Settings › About shows it.
 *
 * Needs a signed-in browser state: set `E2E_STORAGE_STATE` to a Playwright storage state file
 * (T7.1b adds the Supabase fixtures that create one). Without it the spec is skipped. Works with
 * any CHANGELOG.md: it only checks what every build has (title, version, a list or the empty state).
 */
const STORAGE_STATE = process.env.E2E_STORAGE_STATE;

const require = createRequire(import.meta.url);
type Messages = {
  auth: typeof viAuth;
  common: typeof viCommon;
  nav: typeof viNav;
  settings: typeof viSettings;
  whatsNew: typeof viWhatsNew;
};
const messages: Record<"vi" | "en", Messages> = {
  vi: {
    auth: require("@kb/i18n/messages/vi/auth.json"),
    common: require("@kb/i18n/messages/vi/common.json"),
    nav: require("@kb/i18n/messages/vi/nav.json"),
    settings: require("@kb/i18n/messages/vi/settings.json"),
    whatsNew: require("@kb/i18n/messages/vi/whatsNew.json"),
  },
  en: {
    auth: require("@kb/i18n/messages/en/auth.json"),
    common: require("@kb/i18n/messages/en/common.json"),
    nav: require("@kb/i18n/messages/en/nav.json"),
    settings: require("@kb/i18n/messages/en/settings.json"),
    whatsNew: require("@kb/i18n/messages/en/whatsNew.json"),
  },
};

test.skip(!STORAGE_STATE, "E2E_STORAGE_STATE is not set (signed-in state from the T7.1b fixtures)");
test.use({ storageState: STORAGE_STATE });

for (const locale of ["vi", "en"] as const) {
  test.describe(`What's new and version (${locale})`, () => {
    const m = messages[locale];

    test.beforeEach(async ({ context }) => {
      await useLocale(context, locale);
    });

    test("the footer version opens What's new and matches /api/health", async ({
      page,
      request,
    }) => {
      const { version } = (await (await request.get("/api/health")).json()) as { version: string };
      await page.goto("/");

      const footer = page.getByRole("link", {
        name: m.common.shell.versionLink.replace("{version}", version),
      });
      await expect(footer).toHaveText(m.common.shell.version.replace("{version}", version));
      await footer.click();

      await expect(page).toHaveURL(/\/whats-new$/);
      await expect(page.getByRole("heading", { level: 1, name: m.whatsNew.title })).toBeVisible();
      const releases = page.getByRole("article");
      if ((await releases.count()) === 0) {
        await expect(page.getByText(m.whatsNew.empty)).toBeVisible();
      } else {
        await expect(releases.first().getByRole("heading", { level: 2 })).toBeVisible();
      }
    });

    test("Settings › About shows the running version", async ({ page, request }) => {
      const { version } = (await (await request.get("/api/health")).json()) as { version: string };
      await page.goto("/settings");
      const about = page.getByRole("region", { name: m.settings.about.title });
      await expect(
        about.getByText(m.settings.about.version.replace("{version}", version)),
      ).toBeVisible();
      await about.getByRole("link", { name: m.settings.about.whatsNew }).click();
      await expect(page).toHaveURL(/\/whats-new$/);
    });

    test("the account menu links to What's new", async ({ page }) => {
      await page.goto("/settings");
      await page.getByRole("button", { name: m.auth.userMenu.open }).click();
      await page.getByRole("menuitem", { name: m.nav.whatsNew }).click();
      await expect(page).toHaveURL(/\/whats-new$/);
    });
  });
}
