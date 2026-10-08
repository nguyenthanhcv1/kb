import type viNav from "@kb/i18n/messages/vi/nav.json";
import type viTree from "@kb/i18n/messages/vi/tree.json";

import { e2eLocale } from "../support/env";
import { useLocale } from "../support/locale";
import { message } from "../support/messages";
import { addPage, createSpace, openPage, uniqueSuffix } from "../support/space";
import { expect, test } from "../support/test";

/**
 * T2.4, T7.1d — page route: rename in place (the URL follows the new slug and the old link still
 * opens the page), icon, move to trash, restore from the Space trash back to the same place.
 * Creates its own Space and page.
 */
const locale = e2eLocale();
const m = {
  nav: message<typeof viNav>(locale, "nav"),
  tree: message<typeof viTree>(locale, "tree"),
};

test.skip(!process.env.E2E_STORAGE_STATE, "E2E_STORAGE_STATE is not set (see global-setup)");
test.use({ storageState: process.env.E2E_STORAGE_STATE });

test("rename, trash and restore a page", async ({ page, context }, testInfo) => {
  await useLocale(context, locale);
  const suffix = uniqueSuffix(testInfo);
  const slug = await createSpace(page, `Pages ${suffix}`);
  await addPage(page, "Draft");
  const oldPath = await openPage(page, "Draft");
  const shortId = oldPath.slice(-8);

  // Rename: Enter saves, the URL follows the new slug.
  const title = page.getByRole("textbox", { name: m.tree.page.title.label });
  const pageTitle = `E2E trang ${suffix}`;
  await title.fill(pageTitle);
  await title.press("Enter");
  const newPath = `/s/${slug}/p/e2e-trang-${suffix}-${shortId}`;
  await expect(page).toHaveURL(newPath);

  // The link with the previous slug still opens the page (redirect to the canonical URL).
  await page.goto(oldPath);
  await expect(page).toHaveURL(newPath);
  await expect(title).toHaveValue(pageTitle);

  // Icon.
  await page.getByRole("button", { name: m.tree.page.icon.add }).click();
  await page.getByRole("button", { name: "🚀" }).click();
  await expect(page.getByRole("button", { name: m.tree.page.icon.change })).toContainText("🚀");

  // A new page opens for editing; "Done" locks title and icon, "Edit" unlocks them.
  await page.getByRole("button", { name: m.tree.page.mode.doneLabel }).click();
  await expect(title).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: pageTitle })).toBeVisible();
  await expect(page.getByRole("button", { name: m.tree.page.icon.change })).toHaveCount(0);
  await page.getByRole("button", { name: m.tree.page.mode.editLabel }).click();
  await expect(title).toHaveValue(pageTitle);

  // Move to trash → the page shows the trashed notice and appears in the Space trash.
  await page.getByRole("button", { name: m.tree.page.menu }).click();
  await page.getByRole("menuitem", { name: m.tree.actions.moveToTrash }).click();
  await expect(page.getByRole("region", { name: m.tree.page.trashed.title })).toBeVisible();
  await page.getByRole("link", { name: m.tree.page.trashed.openTrash }).click();
  await expect(page).toHaveURL(`/s/${slug}/trash`);
  await expect(page.getByRole("heading", { level: 1, name: m.nav.trash })).toBeVisible();

  // Restore → back where it was, editable again.
  await page
    .getByRole("button", { name: m.tree.trash.restoreLabel.replace("{title}", pageTitle) })
    .click();
  await page.getByRole("status").getByRole("link", { name: m.tree.trash.openPage }).click();
  await expect(page).toHaveURL(newPath);
  await expect(page.getByRole("textbox", { name: m.tree.page.title.label })).toHaveValue(pageTitle);
});
