import { createRequire } from "node:module";

import type viErrors from "@kb/i18n/messages/vi/errors.json";
import type viSpace from "@kb/i18n/messages/vi/space.json";
import { expect, type Page, test } from "@playwright/test";

/**
 * T1.4b — Space: create (slug derived from the name, default `restricted`), duplicate slug error,
 * settings, archive with confirmation. Labels come from the message files (vi and en).
 *
 * Needs a signed-in internal (non-guest) user: set `E2E_STORAGE_STATE` to a Playwright storage
 * state file holding the Supabase session cookies (the signed-in fixtures arrive with T7.1b).
 * Without it the spec is skipped.
 */
const STORAGE_STATE = process.env.E2E_STORAGE_STATE;
const BASE_URL = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000").origin;

const require = createRequire(import.meta.url);
type Messages = { space: typeof viSpace; errors: typeof viErrors };
const messages: Record<"vi" | "en", Messages> = {
  vi: {
    space: require("@kb/i18n/messages/vi/space.json"),
    errors: require("@kb/i18n/messages/vi/errors.json"),
  },
  en: {
    space: require("@kb/i18n/messages/en/space.json"),
    errors: require("@kb/i18n/messages/en/errors.json"),
  },
};

test.skip(!STORAGE_STATE, "E2E_STORAGE_STATE is not set (signed-in internal user, see T7.1b)");
test.use({ storageState: STORAGE_STATE });

async function openCreateDialog(page: Page, m: Messages) {
  await page.goto("/");
  await page.getByRole("main").getByRole("button", { name: m.space.create }).first().click();
  return page.getByRole("dialog", { name: m.space.create });
}

for (const locale of ["vi", "en"] as const) {
  test(`create, configure and archive a space (${locale})`, async ({ page, context }) => {
    const m = messages[locale];
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: BASE_URL }]);
    const suffix = `${locale}-${Date.now().toString(36)}`;
    const name = locale === "vi" ? `Kỹ thuật ${suffix}` : `Engineering ${suffix}`;
    const slug = locale === "vi" ? `ky-thuat-${suffix}` : `engineering-${suffix}`;

    // Create: the slug follows the name; restricted is preselected.
    let dialog = await openCreateDialog(page, m);
    await dialog.getByLabel(m.space.form.name).fill(name);
    await expect(dialog.getByLabel(m.space.form.slug)).toHaveValue(slug);
    await expect(
      dialog.getByRole("radio", { name: new RegExp(m.space.visibility.restricted) }),
    ).toBeChecked();
    await dialog.getByRole("button", { name: m.space.createDialog.submit }).click();
    await expect(page).toHaveURL(`/s/${slug}`);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByRole("navigation").getByRole("link", { name })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // Same slug again → translated error, dialog stays open.
    dialog = await openCreateDialog(page, m);
    await dialog.getByLabel(m.space.form.name).fill(name);
    await dialog.getByRole("button", { name: m.space.createDialog.submit }).click();
    await expect(dialog.getByText(m.errors.SPACE_SLUG_TAKEN)).toBeVisible();
    await page.keyboard.press("Escape");

    // Settings (the creator is admin).
    await page.goto(`/s/${slug}`);
    await page.getByRole("link", { name: m.space.settings }).click();
    await expect(page).toHaveURL(`/s/${slug}/settings`);
    await page.getByLabel(m.space.form.description).fill("E2E");
    await page.getByRole("button", { name: m.space.settingsPage.save }).click();
    await expect(page.getByRole("status")).toHaveText(m.space.settingsPage.saved);

    // Archive: cancel first, then confirm → back to the list, the space is gone.
    await page.getByRole("button", { name: m.space.archiveSection.action }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText(name);
    await confirm.getByRole("button", { name: m.space.archiveSection.confirm }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("link", { name })).toHaveCount(0);
    await page.goto(`/s/${slug}`);
    await expect(page.getByRole("heading", { name: m.space.notFound.title })).toBeVisible();
  });
}
