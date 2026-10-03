import type viHistory from "@kb/i18n/messages/vi/history.json";

import { e2eLocale } from "../support/env";
import { useLocale } from "../support/locale";
import { message } from "../support/messages";
import {
  addPage,
  createSpace,
  editableEditor,
  openPage,
  uniqueSuffix,
  waitForSaved,
} from "../support/space";
import { expect, test } from "../support/test";

/**
 * T6.1–T6.3, T7.1d — version history end to end on a page the test creates: the first save makes
 * an automatic version and leaving the page makes another (snapshot policy, apps/collab
 * snapshots.ts); the history lists them, previews and compares the older one, and restoring it
 * puts its content back (with "Before restore" / "Restored" versions added).
 */
const locale = e2eLocale();
const m = message<typeof viHistory>(locale, "history");

test.skip(!process.env.E2E_STORAGE_STATE, "E2E_STORAGE_STATE is not set (see global-setup)");
test.use({ storageState: process.env.E2E_STORAGE_STATE });

test("versions are saved, compared and restored", async ({ page, context }, testInfo) => {
  await useLocale(context, locale);
  await createSpace(page, `History ${uniqueSuffix(testInfo)}`);
  await addPage(page, "Changelog");
  const pagePath = await openPage(page, "Changelog");

  // First saves → at least one "Autosave" version. Text goes in as one edit (`insertText`).
  // Version numbers are not asserted: the editor may store its initial empty document first, which
  // shifts them.
  const first = "Phiên bản đầu tiên";
  const edited = `${first} — đã sửa`;
  let editor = await editableEditor(page);
  await editor.click();
  await page.keyboard.insertText(first);
  await waitForSaved(page);
  const versions = page.getByRole("navigation", { name: m.listLabel }).getByRole("link");
  await expect(async () => {
    await page.goto(`${pagePath}/history`);
    await expect(versions.first()).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });

  // More text, then leave the page through the history link in its header: the last client
  // leaving makes a version of the edited content.
  await page.goto(pagePath);
  editor = await editableEditor(page);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText(" — đã sửa");
  await waitForSaved(page);
  await page.getByRole("link", { name: m.title }).click();
  await expect(page).toHaveURL(`${pagePath}/history`);
  await expect(page.getByRole("heading", { level: 1, name: m.title })).toBeVisible();

  // The newest version is listed first, selected and previewed.
  const main = page.getByRole("main");
  await expect(async () => {
    await page.reload();
    await expect(main.getByText(edited, { exact: true })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(versions.first()).toHaveAttribute("aria-current", "true");

  // The one below it holds the first text: preview it, then compare it with the current content.
  const older = versions.nth(1);
  await older.click();
  await expect(older).toHaveAttribute("aria-current", "true");
  await expect(main.getByText(first, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: m.modes.diff }).click();
  await expect(page).toHaveURL(/mode=diff/);
  await page.getByRole("link", { name: m.diff.against.current }).click();
  await expect(page).toHaveURL(/against=current/);
  await expect(main.getByText(m.diff.changed).first()).toBeVisible();

  // Restore it → the first text is back; the replaced content was kept as a version.
  await page.getByRole("button", { name: m.restore, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: m.restoreDialog.confirm }).click();
  const done = page.getByRole("status").filter({ hasText: m.restoreDone.title });
  await expect(done).toBeVisible();
  await expect(versions.filter({ hasText: m.reasons.pre_restore })).toHaveCount(1);
  await expect(versions.filter({ hasText: m.reasons.restore })).toHaveCount(1);

  await done.getByRole("link", { name: m.restoreDone.openPage }).click();
  await expect(page).toHaveURL(pagePath);
  editor = await editableEditor(page);
  await expect(editor).toHaveText(first);
});
