import { createRequire } from "node:module";

import type viCommon from "@kb/i18n/messages/vi/common.json";
import type viSettings from "@kb/i18n/messages/vi/settings.json";
import { expect, type Page, test } from "@playwright/test";

/**
 * T1.3 — personal settings: switching the language to English re-renders the whole UI in
 * English and survives on "another device" (the `NEXT_LOCALE` cookie removed: the locale comes
 * from `profiles.locale`); the time zone is saved alongside. Restores Vietnamese at the end.
 *
 * Needs a signed-in user: set `E2E_STORAGE_STATE` to a Playwright storage state file holding the
 * Supabase session cookies (the signed-in fixtures arrive with T7.1b). Skipped without it.
 */
const STORAGE_STATE = process.env.E2E_STORAGE_STATE;

const require = createRequire(import.meta.url);
type Messages = { common: typeof viCommon; settings: typeof viSettings };
const messages: Record<"vi" | "en", Messages> = {
  vi: {
    common: require("@kb/i18n/messages/vi/common.json"),
    settings: require("@kb/i18n/messages/vi/settings.json"),
  },
  en: {
    common: require("@kb/i18n/messages/en/common.json"),
    settings: require("@kb/i18n/messages/en/settings.json"),
  },
};

test.skip(!STORAGE_STATE, "E2E_STORAGE_STATE is not set (signed-in user, see T7.1b)");
test.use({ storageState: STORAGE_STATE });

async function savePreferences(page: Page, from: Messages, locale: "vi" | "en", zone: string) {
  const section = page.getByRole("region", { name: from.settings.preferences.title });
  await section.getByRole("radio", { name: messages[locale].common.locale.names[locale] }).click();
  await section.getByLabel(from.settings.timeZone.label).selectOption(zone);
  await section.getByRole("button", { name: from.common.actions.save }).click();
}

test("language and time zone follow the profile to another device", async ({ page, context }) => {
  const { vi, en } = messages;
  await page.goto("/settings");
  // Start from Vietnamese whatever the account had.
  const title = page.getByRole("heading", { level: 1 });
  if ((await title.textContent()) === en.settings.title) {
    await savePreferences(page, en, "vi", "Asia/Ho_Chi_Minh");
  }
  await expect(title).toHaveText(vi.settings.title);

  await savePreferences(page, vi, "en", "Europe/Berlin");
  await expect(title).toHaveText(en.settings.title);
  await expect(page.getByRole("button", { name: en.common.locale.toggle })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  // "Another device": no language cookie, a Vietnamese browser — the profile still wins.
  await context.clearCookies({ name: "NEXT_LOCALE" });
  await page.setExtraHTTPHeaders({ "Accept-Language": "vi-VN,vi;q=0.9" });
  await page.reload();
  await expect(title).toHaveText(en.settings.title);
  await expect(page.getByLabel(en.settings.timeZone.label, { exact: true })).toHaveValue(
    "Europe/Berlin",
  );

  await savePreferences(page, en, "vi", "Asia/Ho_Chi_Minh");
  await expect(title).toHaveText(vi.settings.title);
});
