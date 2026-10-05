import type viEditor from "@kb/i18n/messages/vi/editor.json";
import type viErrors from "@kb/i18n/messages/vi/errors.json";
import type viSpace from "@kb/i18n/messages/vi/space.json";
import type viTree from "@kb/i18n/messages/vi/tree.json";
import type { Page } from "@playwright/test";

import { e2eLocale, supabaseEnv } from "../support/env";
import { useLocale } from "../support/locale";
import { message } from "../support/messages";
import {
  addPage,
  contextFor,
  createSpace,
  createTestUser,
  editableEditor,
  openPage,
  uniqueSuffix,
  untilStored,
  waitForSaved,
} from "../support/space";
import { expect, test } from "../support/test";

/**
 * T1.4b, T7.1d — Space: create (slug derived from the name, default `restricted`), duplicate slug
 * error, settings, archive with confirmation; a viewer member reads the Space but cannot edit it.
 * Runs in the language of `E2E_LOCALE`; needs the signed-in worker user (global-setup).
 */
const locale = e2eLocale();
const m = {
  editor: message<typeof viEditor>(locale, "editor"),
  errors: message<typeof viErrors>(locale, "errors"),
  space: message<typeof viSpace>(locale, "space"),
  tree: message<typeof viTree>(locale, "tree"),
};

test.skip(!process.env.E2E_STORAGE_STATE, "E2E_STORAGE_STATE is not set (see global-setup)");
test.use({ storageState: process.env.E2E_STORAGE_STATE });

test.beforeEach(async ({ context }) => {
  await useLocale(context, locale);
});

async function openCreateDialog(page: Page) {
  await page.goto("/");
  await page.getByRole("main").getByRole("button", { name: m.space.create }).first().click();
  return page.getByRole("dialog", { name: m.space.create });
}

test("create, configure and archive a space", async ({ page }, testInfo) => {
  const suffix = uniqueSuffix(testInfo);
  const name = locale === "vi" ? `Kỹ thuật ${suffix}` : `Engineering ${suffix}`;
  const slug = locale === "vi" ? `ky-thuat-${suffix}` : `engineering-${suffix}`;

  // Create: the slug follows the name; restricted is preselected.
  let dialog = await openCreateDialog(page);
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
  dialog = await openCreateDialog(page);
  await dialog.getByLabel(m.space.form.name).fill(name);
  await dialog.getByRole("button", { name: m.space.createDialog.submit }).click();
  await expect(dialog.getByText(m.errors.SPACE_SLUG_TAKEN)).toBeVisible();
  await page.keyboard.press("Escape");

  // Settings (the creator is admin).
  await page.goto(`/s/${slug}`);
  await page.getByRole("link", { name: m.space.settings }).click();
  await expect(page).toHaveURL(`/s/${slug}/settings`);
  // Retried as a whole: a click landing before the form hydrates submits nothing. Saving twice is
  // harmless.
  await expect(async () => {
    await page.getByLabel(m.space.form.description).fill("E2E");
    await page.getByRole("button", { name: m.space.settingsPage.save }).click();
    await expect(page.getByRole("status")).toHaveText(m.space.settingsPage.saved, {
      timeout: 2_000,
    });
  }).toPass();

  // Archive: confirm → back to the list, the space is gone.
  await page.getByRole("button", { name: m.space.archiveSection.action }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText(name);
  await confirm.getByRole("button", { name: m.space.archiveSection.confirm }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name })).toHaveCount(0);
  await page.goto(`/s/${slug}`);
  await expect(page.getByRole("heading", { name: m.space.notFound.title })).toBeVisible();
});

test("a viewer reads the space but cannot edit it", async ({ page, browser }, testInfo) => {
  test.skip(!supabaseEnv(), "E2E_SUPABASE_* is not set (creates the viewer)");
  const suffix = uniqueSuffix(testInfo);
  const name = `Viewer ${suffix}`;
  const slug = await createSpace(page, name);
  await addPage(page, "Handbook");
  await openPage(page, "Handbook");
  const editor = await editableEditor(page);
  await editor.click();
  // One edit; the viewer reads it once kb-collab has stored it.
  await page.keyboard.insertText(`Readable ${suffix}`);
  await expect(editor).toContainText(`Readable ${suffix}`);
  await waitForSaved(page);

  const viewer = await createTestUser("viewer", { space: slug, role: "viewer" });
  const context = await contextFor(browser, viewer);
  const view = await context.newPage();
  await view.goto(`/s/${slug}`);
  await expect(view.getByRole("heading", { level: 1, name })).toBeVisible();

  // No editing affordances: no "new page", no Space settings, page title and content read-only.
  const aside = view.locator("aside");
  await expect(aside.getByRole("treeitem", { name: "Handbook" })).toBeVisible();
  await expect(aside.getByRole("button", { name: m.tree.newPage })).toHaveCount(0);
  await expect(view.getByRole("link", { name: m.space.settings })).toHaveCount(0);
  await aside.getByRole("treeitem", { name: "Handbook" }).click();
  await expect(view).toHaveURL(/\/p\//);
  const content = view.getByRole("textbox", { name: m.editor.content.label });
  await untilStored(view, () =>
    expect(content).toContainText(`Readable ${suffix}`, { timeout: 2_000 }),
  );
  await expect(content).toHaveAttribute("contenteditable", "false");
  await expect(view.getByRole("textbox", { name: m.tree.page.title.label })).toHaveCount(0);
  await expect(view.getByRole("button", { name: m.tree.page.menu })).toHaveCount(0);

  // Space settings are refused even by URL.
  await view.goto(`/s/${slug}/settings`);
  await expect(view.getByRole("heading", { name: m.space.forbidden.title })).toBeVisible();
  await expect(view.getByLabel(m.space.form.name)).toHaveCount(0);
  await context.close();
});
