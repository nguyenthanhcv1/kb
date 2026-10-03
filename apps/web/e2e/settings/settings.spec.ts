import type viAuth from "@kb/i18n/messages/vi/auth.json";
import type viCommon from "@kb/i18n/messages/vi/common.json";
import type viSettings from "@kb/i18n/messages/vi/settings.json";
import type { Page } from "@playwright/test";

import { baseUrl, type E2ELocale, e2eLocale, supabaseEnv } from "../support/env";
import { message } from "../support/messages";
import { contextFor, createTestUser, signIn } from "../support/space";
import { expect, test } from "../support/test";

/**
 * T1.3, T7.1d — personal settings: switching the language re-renders the whole UI in it and the
 * choice follows the user to a new session on "another device" (no `NEXT_LOCALE` cookie, a browser
 * asking for the other language): it comes from `profiles.locale`. The time zone is saved
 * alongside. Uses its own users, so signing out leaves the worker's session alone.
 */
const from = e2eLocale();
const to: E2ELocale = from === "vi" ? "en" : "vi";
type Messages = { auth: typeof viAuth; common: typeof viCommon; settings: typeof viSettings };
const load = (locale: E2ELocale): Messages => ({
  auth: message(locale, "auth"),
  common: message(locale, "common"),
  settings: message(locale, "settings"),
});
const m = { [from]: load(from), [to]: load(to) } as Record<E2ELocale, Messages>;
const acceptLanguage = { vi: "vi-VN,vi;q=0.9", en: "en-US,en;q=0.9" };

test.skip(!supabaseEnv(), "E2E_SUPABASE_* is not set (creates the user)");

async function savePreferences(page: Page, current: E2ELocale, locale: E2ELocale, zone: string) {
  const t = m[current];
  const section = page.getByRole("region", { name: t.settings.preferences.title });
  await section.getByRole("radio", { name: m[locale].common.locale.names[locale] }).click();
  await section.getByLabel(t.settings.timeZone.label).selectOption(zone);
  await section.getByRole("button", { name: t.common.actions.save }).click();
}

test("language and time zone follow the profile to another device", async ({ browser }) => {
  const user = await createTestUser("locale", { locale: from });
  const first = await contextFor(browser, user);
  const page = await first.newPage();
  await page.goto("/settings");
  const title = page.getByRole("heading", { level: 1 });
  await expect(title).toHaveText(m[from].settings.title);

  await savePreferences(page, from, to, "Europe/Berlin");
  await expect(title).toHaveText(m[to].settings.title);
  await expect(page.locator("html")).toHaveAttribute("lang", to);
  await expect(page.getByRole("button", { name: m[to].common.locale.toggle })).toBeVisible();
  await first.close();

  // "Another device": a new session in a browser asking for the previous language, without the
  // language cookie — the profile wins.
  const second = await browser.newContext({
    baseURL: baseUrl(),
    locale: from === "en" ? "en-US" : "vi-VN",
    extraHTTPHeaders: { "Accept-Language": acceptLanguage[from] },
  });
  await signIn(second, user, from);
  await second.clearCookies({ name: "NEXT_LOCALE" });
  const again = await second.newPage();
  await again.goto("/settings");
  await expect(again.getByRole("heading", { level: 1 })).toHaveText(m[to].settings.title);
  await expect(again.locator("html")).toHaveAttribute("lang", to);
  await expect(again.getByLabel(m[to].settings.timeZone.label, { exact: true })).toHaveValue(
    "Europe/Berlin",
  );
  await second.close();
});

// FIXME(app bug, found by T7.1d): the account menu and the login page still import the T1.2a
// mocks (`@/server/auth/mock-actions`): "Sign out" only deletes the mock cookie, so the Supabase
// session stays and the user is still signed in. Switch them to `@/server/auth` and drop `fixme`.
test.fixme("signing out ends the session", async ({ browser }) => {
  const user = await createTestUser("signout");
  const context = await contextFor(browser, user);
  const page = await context.newPage();
  await page.goto("/settings");
  await page.getByRole("button", { name: m[from].auth.userMenu.open }).click();
  await page.getByRole("menuitem", { name: m[from].auth.userMenu.signOut }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(m[from].auth.login.signedOut)).toBeVisible();
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login/);
  await context.close();
});
