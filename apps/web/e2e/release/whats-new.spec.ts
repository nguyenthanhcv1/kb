import type viAuth from "@kb/i18n/messages/vi/auth.json";
import type viCommon from "@kb/i18n/messages/vi/common.json";
import type viNav from "@kb/i18n/messages/vi/nav.json";
import type viSettings from "@kb/i18n/messages/vi/settings.json";
import type viWhatsNew from "@kb/i18n/messages/vi/whatsNew.json";

import { e2eLocale } from "../support/env";
import { useLocale } from "../support/locale";
import { message } from "../support/messages";
import { expect, test } from "../support/test";

/**
 * T0.6b, T7.1d — the running version in the sidebar footer leads to What's new; Settings › About
 * shows it. Works with any CHANGELOG.md: it only checks what every build has (title, version, a
 * list or the empty state). Runs in the language of `E2E_LOCALE`.
 */
const locale = e2eLocale();
const m = {
  auth: message<typeof viAuth>(locale, "auth"),
  common: message<typeof viCommon>(locale, "common"),
  nav: message<typeof viNav>(locale, "nav"),
  settings: message<typeof viSettings>(locale, "settings"),
  whatsNew: message<typeof viWhatsNew>(locale, "whatsNew"),
};

test.skip(!process.env.E2E_STORAGE_STATE, "E2E_STORAGE_STATE is not set (see global-setup)");
test.use({ storageState: process.env.E2E_STORAGE_STATE });

test.beforeEach(async ({ context }) => {
  await useLocale(context, locale);
});

test("the footer version opens What's new and matches /api/health", async ({ page, request }) => {
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
