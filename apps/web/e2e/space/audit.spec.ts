import { createRequire } from "node:module";

import type viAudit from "@kb/i18n/messages/vi/audit.json";
import type viSpace from "@kb/i18n/messages/vi/space.json";
import { expect, test } from "@playwright/test";
import { useLocale } from "../support/locale";

/**
 * T1.6b/T6.4b — Space activity log: a new Space shows its "created" and "updated" entries with
 * translated labels; the action, type and date filters narrow the list and can be cleared; the
 * filtered log downloads as CSV.
 *
 * Needs a signed-in internal (non-guest) user: `E2E_STORAGE_STATE` (see `space.spec.ts`).
 */
const STORAGE_STATE = process.env.E2E_STORAGE_STATE;

const require = createRequire(import.meta.url);
type Messages = { audit: typeof viAudit; space: typeof viSpace };
const messages: Record<"vi" | "en", Messages> = {
  vi: {
    audit: require("@kb/i18n/messages/vi/audit.json"),
    space: require("@kb/i18n/messages/vi/space.json"),
  },
  en: {
    audit: require("@kb/i18n/messages/en/audit.json"),
    space: require("@kb/i18n/messages/en/space.json"),
  },
};

test.skip(!STORAGE_STATE, "E2E_STORAGE_STATE is not set (signed-in internal user, see T7.1b)");
test.use({ storageState: STORAGE_STATE });

for (const locale of ["vi", "en"] as const) {
  test(`space activity log with action filter (${locale})`, async ({ page, context }) => {
    const m = messages[locale];
    await useLocale(context, locale);
    const suffix = `${locale}-${Date.now().toString(36)}`;
    const name = `Audit ${suffix}`;
    const slug = `audit-${suffix}`;

    // Create a Space and change it once → space.create + space.update entries.
    await page.goto("/");
    await page.getByRole("main").getByRole("button", { name: m.space.create }).first().click();
    const dialog = page.getByRole("dialog", { name: m.space.create });
    await dialog.getByLabel(m.space.form.name).fill(name);
    await dialog.getByRole("button", { name: m.space.createDialog.submit }).click();
    await expect(page).toHaveURL(`/s/${slug}`);
    await page.goto(`/s/${slug}/settings`);
    // Retried as a whole: a click landing before the form hydrates submits nothing.
    await expect(async () => {
      await page.getByLabel(m.space.form.description).fill("E2E");
      await page.getByRole("button", { name: m.space.settingsPage.save }).click();
      await expect(page.getByRole("status")).toHaveText(m.space.settingsPage.saved, {
        timeout: 2_000,
      });
    }).toPass();

    // Settings tab → activity log.
    await page
      .getByRole("navigation", { name: m.space.settingsPage.navLabel })
      .getByRole("link", { name: m.space.settingsPage.audit })
      .click();
    await expect(page).toHaveURL(`/s/${slug}/settings/audit`);
    const list = page.getByRole("list", { name: m.audit.page.listLabel });
    await expect(list.getByText(m.audit.actions.space_create)).toBeVisible();
    await expect(list.getByText(m.audit.actions.space_update)).toBeVisible();
    await expect(list.getByText(new RegExp(`^${m.audit.fields.description}:`))).toBeVisible();

    // Filter by action, then clear.
    await page.getByLabel(m.audit.page.filterLabel).selectOption("space.create");
    await expect(page).toHaveURL(`/s/${slug}/settings/audit?action=space.create`);
    await expect(list.getByText(m.audit.actions.space_update)).toHaveCount(0);
    await expect(list.getByText(m.audit.actions.space_create)).toBeVisible();

    await page.getByLabel(m.audit.page.filterLabel).selectOption("space.archive");
    await expect(page.getByText(m.audit.page.emptyFiltered)).toBeVisible();
    await page.getByRole("link", { name: m.audit.page.resetFilters }).click();
    await expect(page).toHaveURL(`/s/${slug}/settings/audit`);
    await expect(list.getByText(m.audit.actions.space_update)).toBeVisible();

    // T6.4b — type, person and date filters, and CSV export of the filtered set.
    await page.getByLabel(m.audit.page.typeLabel).selectOption("member");
    await expect(page).toHaveURL(`/s/${slug}/settings/audit?type=member`);
    await expect(list.getByText(m.audit.actions.space_create)).toHaveCount(0);
    await page.getByRole("button", { name: m.audit.page.resetFilters }).click();
    await expect(page).toHaveURL(`/s/${slug}/settings/audit`);

    // "Today" in the user's time zone (the filter's), not UTC: they differ from 00:00 to 07:00.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(
      new Date(),
    );
    await page.getByLabel(m.audit.page.fromLabel).fill(today);
    await expect(page).toHaveURL(new RegExp(`from=${today}`));
    await expect(list.getByText(m.audit.actions.space_create)).toBeVisible();
    await page.getByLabel(m.audit.page.toLabel).fill("2000-01-01");
    await expect(page.getByText(m.audit.page.rangeInvalid)).toBeVisible();
    await page.getByLabel(m.audit.page.toLabel).fill(today);
    await expect(list.getByText(m.audit.actions.space_create)).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: m.audit.export.button }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^audit-.*\.csv$/);
    await expect(page.getByRole("status").filter({ hasText: m.audit.export.done })).toBeVisible();
  });
}
