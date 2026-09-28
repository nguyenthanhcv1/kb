import { createRequire } from "node:module";

import type viSpace from "@kb/i18n/messages/vi/space.json";
import type viTree from "@kb/i18n/messages/vi/tree.json";
import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * T2.3 — sidebar page tree: create and rename pages inline, reorder with the keyboard, nest by
 * drag-and-drop, order and expanded state kept after a reload, move to trash from the menu.
 *
 * Needs a signed-in internal user (`E2E_STORAGE_STATE`, see space.spec.ts / T7.1b); skipped
 * without it. Each run creates its own Space.
 */
const STORAGE_STATE = process.env.E2E_STORAGE_STATE;
const BASE_URL = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000").origin;

const require = createRequire(import.meta.url);
type Messages = { space: typeof viSpace; tree: typeof viTree };
const messages: Record<"vi" | "en", Messages> = {
  vi: {
    space: require("@kb/i18n/messages/vi/space.json"),
    tree: require("@kb/i18n/messages/vi/tree.json"),
  },
  en: {
    space: require("@kb/i18n/messages/en/space.json"),
    tree: require("@kb/i18n/messages/en/tree.json"),
  },
};

test.skip(!STORAGE_STATE, "E2E_STORAGE_STATE is not set (signed-in internal user, see T7.1b)");
test.use({ storageState: STORAGE_STATE });

const tree = (page: Page) => page.locator("aside").getByRole("tree");
const rows = (page: Page) => tree(page).getByRole("treeitem");

async function newPage(page: Page, m: Messages, title: string) {
  await page.locator("aside").getByRole("button", { name: m.tree.newPage }).click();
  const input = page.locator("aside").getByRole("textbox", { name: m.tree.renameLabel });
  await input.fill(title);
  await input.press("Enter");
  await expect(tree(page).getByRole("treeitem", { name: title })).toBeVisible();
}

async function dragOnto(page: Page, source: Locator, target: Locator, offsetX: number) {
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + 10, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(to.x + 10 + offsetX, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
}

for (const locale of ["vi", "en"] as const) {
  test(`build a page tree in the sidebar (${locale})`, async ({ page, context }) => {
    const m = messages[locale];
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: BASE_URL }]);
    const suffix = `${locale}-${Date.now().toString(36)}`;
    const name = `Tree ${suffix}`;

    await page.goto("/");
    await page.getByRole("main").getByRole("button", { name: m.space.create }).first().click();
    const dialog = page.getByRole("dialog", { name: m.space.create });
    await dialog.getByLabel(m.space.form.name).fill(name);
    await dialog.getByRole("button", { name: m.space.createDialog.submit }).click();
    await expect(page).toHaveURL(new RegExp(`/s/tree-${suffix}$`));
    await expect(page.locator("aside").getByText(m.tree.empty)).toBeVisible();

    for (const title of ["Alpha", "Beta", "Gamma"]) await newPage(page, m, title);
    await expect(rows(page)).toHaveText(["Alpha", "Beta", "Gamma"]);

    // Keyboard: arrows move focus, Alt+Shift+Up reorders; the order survives a reload.
    await rows(page).first().focus();
    await page.keyboard.press("End");
    await expect(tree(page).getByRole("treeitem", { name: "Gamma" })).toBeFocused();
    await page.keyboard.press("Alt+Shift+ArrowUp");
    await expect(rows(page)).toHaveText(["Alpha", "Gamma", "Beta"]);
    await page.reload();
    await expect(rows(page)).toHaveText(["Alpha", "Gamma", "Beta"]);

    // Drag Beta up over Gamma (→ right below Alpha) and one level to the right → nested under
    // Alpha; Alpha stays expanded after a reload.
    const beta = tree(page).getByRole("treeitem", { name: "Beta" });
    await dragOnto(page, beta, tree(page).getByRole("treeitem", { name: "Gamma" }), 24);
    await expect(beta).toHaveAttribute("aria-level", "2");
    await page.reload();
    await expect(tree(page).getByRole("treeitem", { name: "Alpha" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(tree(page).getByRole("treeitem", { name: "Beta" })).toHaveAttribute(
      "aria-level",
      "2",
    );

    // Menu from the keyboard → move to trash.
    await tree(page).getByRole("treeitem", { name: "Gamma" }).focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: m.tree.actions.moveToTrash }).click();
    await expect(tree(page).getByRole("treeitem", { name: "Gamma" })).toHaveCount(0);
    await page.reload();
    await expect(rows(page)).toHaveText(["Alpha", "Beta"]);
  });
}
