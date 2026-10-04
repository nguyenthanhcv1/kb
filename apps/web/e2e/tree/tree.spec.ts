import type viNav from "@kb/i18n/messages/vi/nav.json";
import type viTree from "@kb/i18n/messages/vi/tree.json";
import type { Locator, Page } from "@playwright/test";

import { e2eLocale } from "../support/env";
import { useLocale } from "../support/locale";
import { message } from "../support/messages";
import { addPage, createSpace, sidebarTree, uniqueSuffix } from "../support/space";
import { expect, test } from "../support/test";

/**
 * T2.3, T7.1d — sidebar page tree: create pages inline, reorder with the keyboard, nest by
 * drag-and-drop, order and expanded state kept after a reload, move a branch to the trash, restore
 * it to the same place, delete a page permanently. Each test creates its own Space.
 */
const locale = e2eLocale();
const m = {
  nav: message<typeof viNav>(locale, "nav"),
  tree: message<typeof viTree>(locale, "tree"),
};

test.skip(!process.env.E2E_STORAGE_STATE, "E2E_STORAGE_STATE is not set (see global-setup)");
test.use({ storageState: process.env.E2E_STORAGE_STATE });

test.beforeEach(async ({ context }) => {
  await useLocale(context, locale);
});

const rows = (page: Page) => sidebarTree(page).getByRole("treeitem");
const row = (page: Page, name: string) => sidebarTree(page).getByRole("treeitem", { name });

async function dragOnto(page: Page, source: Locator, target: Locator, offsetX: number) {
  // The Space list above the tree grows with every Space the worker's user made: bring the rows
  // into the viewport, the mouse only reaches what is on screen.
  await source.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + 10, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(to.x + 10 + offsetX, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
}

async function moveToTrash(page: Page, name: string) {
  await row(page, name).focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: m.tree.actions.moveToTrash }).click();
  await expect(row(page, name)).toHaveCount(0);
}

test("build a page tree, trash and restore a branch", async ({ page }, testInfo) => {
  const slug = await createSpace(page, `Tree ${uniqueSuffix(testInfo)}`);
  await expect(page.locator("aside").getByText(m.tree.empty)).toBeVisible();

  for (const title of ["Alpha", "Beta", "Gamma"]) await addPage(page, title);
  await expect(rows(page)).toHaveText(["Alpha", "Beta", "Gamma"]);

  // Keyboard: arrows move focus, Alt+Shift+Up reorders; the order survives a reload.
  await rows(page).first().focus();
  await page.keyboard.press("End");
  await expect(row(page, "Gamma")).toBeFocused();
  await page.keyboard.press("Alt+Shift+ArrowUp");
  await expect(rows(page)).toHaveText(["Alpha", "Gamma", "Beta"]);
  await page.reload();
  await expect(rows(page)).toHaveText(["Alpha", "Gamma", "Beta"]);

  // Drag Beta up over Gamma (→ right below Alpha) and one level to the right → nested under
  // Alpha; Alpha stays expanded after a reload.
  await dragOnto(page, row(page, "Beta"), row(page, "Gamma"), 24);
  await expect(row(page, "Beta")).toHaveAttribute("aria-level", "2");
  await page.reload();
  await expect(row(page, "Alpha")).toHaveAttribute("aria-expanded", "true");
  await expect(row(page, "Beta")).toHaveAttribute("aria-level", "2");

  // Trash the Alpha branch (Beta goes with it) and Gamma.
  await moveToTrash(page, "Alpha");
  await expect(row(page, "Beta")).toHaveCount(0);
  await moveToTrash(page, "Gamma");
  await expect(page.locator("aside").getByText(m.tree.empty)).toBeVisible();

  // The trash lists both; restoring Alpha brings Beta back under it.
  await page.locator("aside").getByRole("link", { name: m.nav.trash }).click();
  await expect(page).toHaveURL(`/s/${slug}/trash`);
  const trash = page.getByRole("list", { name: m.tree.trash.listLabel });
  // The sidebar drops a row before the server has stored the move: reload until both are listed.
  await expect(async () => {
    await page.reload();
    await expect(trash.getByRole("listitem")).toHaveCount(2, { timeout: 1_000 });
  }).toPass();
  await trash
    .getByRole("button", { name: m.tree.trash.restoreLabel.replace("{title}", "Alpha") })
    .click();
  await expect(
    page.getByRole("status").getByText(m.tree.trash.restored.replace("{title}", "Alpha")),
  ).toBeVisible();
  await expect(trash.getByRole("listitem")).toHaveCount(1);
  // The sidebar is checked after a reload: its live update (Realtime, T2.5) is not covered here
  // (the channel currently joins without the user's token, see the T7.1d PR).
  await page.reload();
  await expect(row(page, "Alpha")).toBeVisible();
  await row(page, "Alpha").focus();
  await page.keyboard.press("ArrowRight");
  await expect(row(page, "Beta")).toHaveAttribute("aria-level", "2");

  // Delete Gamma permanently: confirm → gone from the trash for good.
  await trash
    .getByRole("button", { name: m.tree.trash.purgeLabel.replace("{title}", "Gamma") })
    .click();
  const confirm = page.getByRole("alertdialog", { name: m.tree.trash.purgeConfirmTitle });
  await confirm.getByRole("button", { name: m.tree.trash.purge }).click();
  await expect(
    page.getByRole("status").getByText(m.tree.trash.purged.replace("{title}", "Gamma")),
  ).toBeVisible();
  await expect(page.getByText(m.tree.trash.empty)).toBeVisible();
  await page.reload();
  await expect(page.getByText(m.tree.trash.empty)).toBeVisible();
  await expect(rows(page)).toHaveText(["Alpha", "Beta"]);
});
