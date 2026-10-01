import { createRequire } from "node:module";

import type viHistory from "@kb/i18n/messages/vi/history.json";
import { expect, test } from "@playwright/test";

/**
 * T6.2 — version history route: open it from the page header, pick a version, preview it and
 * compare it with the current content. Needs a signed-in user (`E2E_STORAGE_STATE`) and
 * `E2E_PAGE_PATH`, a page with at least one saved version. Read-only; skipped without them.
 */
const STORAGE_STATE = process.env.E2E_STORAGE_STATE;
const PAGE_PATH = process.env.E2E_PAGE_PATH;
const BASE_URL = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000").origin;

const require = createRequire(import.meta.url);
const messages: Record<"vi" | "en", typeof viHistory> = {
  vi: require("@kb/i18n/messages/vi/history.json"),
  en: require("@kb/i18n/messages/en/history.json"),
};

test.skip(!STORAGE_STATE || !PAGE_PATH, "E2E_STORAGE_STATE / E2E_PAGE_PATH are not set");
test.use({ storageState: STORAGE_STATE });

for (const locale of ["vi", "en"] as const) {
  test(`browse and compare versions (${locale})`, async ({ page, context }) => {
    const m = messages[locale];
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: BASE_URL }]);

    await page.goto(PAGE_PATH!);
    await page.getByRole("link", { name: m.title }).click();
    await expect(page).toHaveURL(/\/history$/);
    await expect(page.getByRole("heading", { name: m.title, level: 1 })).toBeVisible();

    const list = page.getByRole("navigation", { name: m.listLabel });
    await expect(list.getByRole("link").first()).toHaveAttribute("aria-current", "true");

    await page.getByRole("link", { name: m.modes.diff }).click();
    await expect(page).toHaveURL(/mode=diff/);
    await page.getByRole("link", { name: m.diff.against.current }).click();
    await expect(page).toHaveURL(/against=current/);
  });
}
