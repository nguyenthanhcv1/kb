import { createRequire } from "node:module";

import type viCommon from "@kb/i18n/messages/vi/common.json";
import type viNav from "@kb/i18n/messages/vi/nav.json";
import type viTree from "@kb/i18n/messages/vi/tree.json";
import { expect, test } from "@playwright/test";
import { useLocale } from "../support/locale";

/**
 * T2.4 — page route: rename in place (the URL follows the new slug and the old link still opens
 * the page), icon, move to trash, restore from the Space trash back to the same place.
 *
 * Needs a signed-in editor (`E2E_STORAGE_STATE`, see space.spec.ts) and `E2E_PAGE_PATH`, the
 * path of a live page they can edit (e.g. `/s/design/p/huong-dan-a1B2c3D4`; page creation from
 * the sidebar arrives with T2.3). Skipped without them. The page title is changed by the run.
 */
const STORAGE_STATE = process.env.E2E_STORAGE_STATE;
const PAGE_PATH = process.env.E2E_PAGE_PATH;

const require = createRequire(import.meta.url);
type Messages = { common: typeof viCommon; nav: typeof viNav; tree: typeof viTree };
const messages: Record<"vi" | "en", Messages> = {
  vi: {
    common: require("@kb/i18n/messages/vi/common.json"),
    nav: require("@kb/i18n/messages/vi/nav.json"),
    tree: require("@kb/i18n/messages/vi/tree.json"),
  },
  en: {
    common: require("@kb/i18n/messages/en/common.json"),
    nav: require("@kb/i18n/messages/en/nav.json"),
    tree: require("@kb/i18n/messages/en/tree.json"),
  },
};

test.skip(!STORAGE_STATE || !PAGE_PATH, "E2E_STORAGE_STATE / E2E_PAGE_PATH are not set");
test.use({ storageState: STORAGE_STATE });
// Both locales edit the same page.
test.describe.configure({ mode: "serial" });

for (const locale of ["vi", "en"] as const) {
  test(`rename, trash and restore a page (${locale})`, async ({ page, context }) => {
    const m = messages[locale];
    await useLocale(context, locale);
    const spacePath = PAGE_PATH!.split("/p/")[0]!;
    const shortId = PAGE_PATH!.slice(-8);
    const suffix = `${locale}-${Date.now().toString(36)}`;

    // Rename: Enter saves, the URL follows the new slug.
    await page.goto(PAGE_PATH!);
    const title = page.getByRole("textbox", { name: m.tree.page.title.label });
    const oldUrl = page.url();
    await title.fill(`E2E trang ${suffix}`);
    await title.press("Enter");
    const newPath = `${spacePath}/p/e2e-trang-${suffix}-${shortId}`;
    await expect(page).toHaveURL(newPath);

    // The link with the previous slug still opens the page (redirect to the canonical URL).
    await page.goto(oldUrl);
    await expect(page).toHaveURL(newPath);
    await expect(title).toHaveValue(`E2E trang ${suffix}`);

    // Icon.
    await page
      .getByRole("button", {
        name: new RegExp(`${m.tree.page.icon.add}|${m.tree.page.icon.change}`),
      })
      .click();
    await page.getByRole("button", { name: "🚀" }).click();
    await expect(page.getByRole("button", { name: m.tree.page.icon.change })).toContainText("🚀");

    // Move to trash → the page shows the trashed notice and appears in the Space trash.
    await page.getByRole("button", { name: m.tree.page.menu }).click();
    await page.getByRole("menuitem", { name: m.tree.actions.moveToTrash }).click();
    await expect(page.getByRole("region", { name: m.tree.page.trashed.title })).toBeVisible();
    await page.getByRole("link", { name: m.tree.page.trashed.openTrash }).click();
    await expect(page).toHaveURL(`${spacePath}/trash`);
    await expect(page.getByRole("heading", { level: 1, name: m.nav.trash })).toBeVisible();

    // Restore → back where it was, editable again.
    const pageTitle = `E2E trang ${suffix}`;
    await page
      .getByRole("button", { name: m.tree.trash.restoreLabel.replace("{title}", pageTitle) })
      .click();
    await page.getByRole("status").getByRole("link", { name: m.tree.trash.openPage }).click();
    await expect(page).toHaveURL(newPath);
    await expect(page.getByRole("textbox", { name: m.tree.page.title.label })).toHaveValue(
      pageTitle,
    );
  });
}
