import { createRequire } from "node:module";

import type viSearch from "@kb/i18n/messages/vi/search.json";
import { expect, test } from "@playwright/test";

/**
 * T5.3 — quick switcher (Ctrl+K) and the results page, driven by the keyboard only. Needs a
 * signed-in user (`E2E_STORAGE_STATE`) and `E2E_SEARCH_QUERY`, a keyword that matches at least one
 * page that user can read. Read-only; skipped without them. Set `E2E_SCREENSHOT_DIR` to also save
 * screenshots (run once per locale/theme: `NEXT_LOCALE` cookie and `colorScheme` are set below).
 */
const STORAGE_STATE = process.env.E2E_STORAGE_STATE;
const QUERY = process.env.E2E_SEARCH_QUERY;
const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const BASE_URL = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000").origin;

const require = createRequire(import.meta.url);
const messages: Record<"vi" | "en", typeof viSearch> = {
  vi: require("@kb/i18n/messages/vi/search.json"),
  en: require("@kb/i18n/messages/en/search.json"),
};

test.skip(!STORAGE_STATE || !QUERY, "E2E_STORAGE_STATE / E2E_SEARCH_QUERY are not set");
test.use({ storageState: STORAGE_STATE });

for (const locale of ["vi", "en"] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`quick switcher and results page (${locale}, ${scheme})`, async ({ page, context }) => {
      const m = messages[locale];
      await page.emulateMedia({ colorScheme: scheme });
      await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: BASE_URL }]);

      await page.goto("/");
      await page.keyboard.press("Control+k");
      const box = page.getByRole("combobox", { name: m.placeholder });
      await expect(box).toBeFocused();
      await box.fill(QUERY!);
      const options = page.getByRole("option");
      await expect(options.first()).toBeVisible();
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/switcher-${locale}-${scheme}.png` });

      // Last row = "see all results": ArrowUp wraps to it.
      await box.press("ArrowUp");
      await box.press("Enter");
      await expect(page).toHaveURL(/\/search\?q=/);
      await expect(page.getByRole("heading", { level: 1, name: m.results.title })).toBeVisible();
      await expect(
        page
          .getByRole("link")
          .filter({ has: page.locator("mark") })
          .first(),
      ).toBeVisible();
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/results-${locale}-${scheme}.png` });
    });
  }
}
