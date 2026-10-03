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

  // First save → version 1 ("Autosave"). Text goes in as one edit (`insertText`) so the first
  // store, which makes the version, always holds all of it.
  let editor = await editableEditor(page);
  await editor.click();
  await page.keyboard.insertText("Phiên bản đầu tiên");
  await waitForSaved(page);
  const versions = page.getByRole("navigation", { name: m.listLabel }).getByRole("link");
  const v = (no: number) => versions.filter({ hasText: m.versionNo.replace("{no}", String(no)) });
  await expect(async () => {
    await page.goto(`${pagePath}/history`);
    await expect(v(1)).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });

  // More text, then leave the page through the history link in its header: the last client
  // leaving makes version 2. (Opening the page again would add one more version on the next leave.)
  await page.goto(pagePath);
  editor = await editableEditor(page);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText(" — đã sửa");
  await waitForSaved(page);
  await page.getByRole("link", { name: m.title }).click();
  await expect(page).toHaveURL(`${pagePath}/history`);
  await expect(page.getByRole("heading", { level: 1, name: m.title })).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(v(2)).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });

  // The newest version is listed first and selected.
  await expect(versions.first()).toHaveAttribute("aria-current", "true");
  await expect(versions.first()).toContainText(m.versionNo.replace("{no}", "2"));

  // Preview version 1, then compare it with the current content.
  await v(1).click();
  await expect(v(1)).toHaveAttribute("aria-current", "true");
  const main = page.getByRole("main");
  await expect(main.getByText("Phiên bản đầu tiên", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: m.modes.diff }).click();
  await expect(page).toHaveURL(/mode=diff/);
  await page.getByRole("link", { name: m.diff.against.current }).click();
  await expect(page).toHaveURL(/against=current/);
  await expect(main.getByText(m.diff.changed).first()).toBeVisible();

  // Restore version 1 → its content is back; the previous content was kept as a version.
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
  await expect(editor).toHaveText("Phiên bản đầu tiên");
});
