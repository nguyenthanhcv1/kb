import { createRequire } from "node:module";

import type viEditor from "@kb/i18n/messages/vi/editor.json";
import type viTable from "@kb/i18n/messages/vi/table.json";
import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * T4.1 — basic table: insert from "/", type with Tab, add rows/columns from the table toolbar,
 * merge / split / colour cells (T4.2),
 * export CSV, horizontal scroll on a phone. Labels come from the message files (vi and en), so
 * the spec follows translation changes.
 *
 * Needs a page showing the block editor with edit rights: set `E2E_EDITOR_PATH` (e.g. a page
 * created by the E2E fixtures of T7.1b). Without it the spec is skipped.
 */
const EDITOR_PATH = process.env.E2E_EDITOR_PATH;
const BASE_URL = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000").origin;

const require = createRequire(import.meta.url);
type Messages = { editor: typeof viEditor; table: typeof viTable };
const messages: Record<"vi" | "en", Messages> = {
  vi: {
    editor: require("@kb/i18n/messages/vi/editor.json"),
    table: require("@kb/i18n/messages/vi/table.json"),
  },
  en: {
    editor: require("@kb/i18n/messages/en/editor.json"),
    table: require("@kb/i18n/messages/en/table.json"),
  },
};

test.skip(!EDITOR_PATH, "E2E_EDITOR_PATH is not set (page with the editor, see T3.5/T7.1b)");

async function openEditor(page: Page, locale: "vi" | "en") {
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: BASE_URL }]);
  await page.goto(EDITOR_PATH!);
  const editor = page.getByRole("textbox", { name: messages[locale].editor.content.label });
  await expect(editor).toBeVisible();
  return editor;
}

/** Inserts a table on a new line at the end of the document with the "/" menu. */
async function insertTable(page: Page, editor: Locator, locale: "vi" | "en") {
  const { editor: m } = messages[locale];
  // The last top-level block (the editor keeps a paragraph after tables).
  await editor.locator(":scope > *").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(`/${locale === "vi" ? "bang" : "table"}`);
  await page
    .getByRole("option", { name: new RegExp(m.slash.items.table.title) })
    .first()
    .click();
  return editor.locator("table").last();
}

const cellTexts = (table: Locator) =>
  table
    .locator("tr")
    .evaluateAll((rows) =>
      rows.map((row) =>
        Array.from(row.querySelectorAll("th, td")).map((cell) => cell.textContent ?? ""),
      ),
    );

for (const locale of ["vi", "en"] as const) {
  test.describe(`table (${locale})`, () => {
    const t = messages[locale].table;

    test("insert a table, type across cells, add rows and columns", async ({ page }) => {
      const editor = await openEditor(page, locale);
      const table = await insertTable(page, editor, locale);

      // 3×3 with a header row, caret in the first header cell.
      await expect(table.locator("tr")).toHaveCount(3);
      await expect(table.locator("tr").first().locator("th")).toHaveCount(3);

      await page.keyboard.type("Mã");
      await page.keyboard.press("Tab");
      await page.keyboard.type("Tên");
      await page.keyboard.press("Tab");
      await page.keyboard.type("Ghi chú");
      await page.keyboard.press("Tab");
      await page.keyboard.type("NV-001");
      expect((await cellTexts(table)).slice(0, 2)).toEqual([
        ["Mã", "Tên", "Ghi chú"],
        ["NV-001", "", ""],
      ]);

      const toolbar = page.getByRole("toolbar", { name: t.menu.label });
      await expect(toolbar).toBeVisible();
      await toolbar.getByRole("button", { name: t.actions.addRowAfter }).click();
      await expect(table.locator("tr")).toHaveCount(4);
      await toolbar.getByRole("button", { name: t.actions.addColumnAfter }).click();
      await expect(table.locator("tr").first().locator("th, td")).toHaveCount(4);

      // Menu: insert row above, toggle the header column.
      await toolbar.getByRole("button", { name: t.menu.options }).click();
      await page.getByRole("menuitem", { name: t.actions.addRowBefore }).click();
      await expect(table.locator("tr")).toHaveCount(5);
      await expect(page.getByRole("menu")).toHaveCount(0); // closing animation done
      await toolbar.getByRole("button", { name: t.menu.options }).click();
      await page.getByRole("menuitemcheckbox", { name: t.actions.toggleHeaderColumn }).click();
      await expect(table.locator("tr").nth(1).locator("th")).toHaveCount(1);

      // Tab in the last cell appends a row.
      await table.locator("tr").last().locator("td").last().click();
      await page.keyboard.press("Tab");
      await expect(table.locator("tr")).toHaveCount(6);
    });

    test("export the table as CSV", async ({ page }) => {
      const editor = await openEditor(page, locale);
      const table = await insertTable(page, editor, locale);
      await page.keyboard.type("Họ tên");
      await expect(table.locator("th").first()).toHaveText("Họ tên");

      const toolbar = page.getByRole("toolbar", { name: t.menu.label });
      const download = page.waitForEvent("download");
      await toolbar.getByRole("button", { name: t.actions.exportCsv }).click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(/\.csv$/);
      const stream = await file.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      const bytes = Buffer.concat(chunks);
      expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(bytes.subarray(3).toString("utf8").split("\r\n")[0]).toBe("Họ tên,,");
    });

    test("keyboard: Alt+F10 opens the table toolbar, Escape goes back", async ({ page }) => {
      const editor = await openEditor(page, locale);
      await insertTable(page, editor, locale);
      await page.keyboard.press("Alt+F10");
      const trigger = page
        .getByRole("toolbar", { name: t.menu.label })
        .getByRole("button", { name: t.menu.options });
      await expect(trigger).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menu")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(editor).toBeFocused();
    });

    test("select cells, merge, colour and split them (T4.2)", async ({ page }) => {
      const editor = await openEditor(page, locale);
      const table = await insertTable(page, editor, locale);
      const cell = (row: number, col: number) =>
        table.locator("tr").nth(row).locator("th, td").nth(col);

      // Drag from the first body cell to the next one: a 2-cell selection.
      await cell(1, 0).click();
      await page.keyboard.type("a");
      const from = (await cell(1, 0).boundingBox())!;
      const to = (await cell(1, 1).boundingBox())!;
      await page.mouse.move(from.x + 10, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 });
      await page.mouse.up();
      await expect(table.locator(".selectedCell")).toHaveCount(2);

      const toolbar = page.getByRole("toolbar", { name: t.menu.label });
      await toolbar.getByRole("button", { name: t.menu.options }).click();
      await page.getByRole("menuitem", { name: t.actions.mergeCells }).click();
      await expect(cell(1, 0)).toHaveAttribute("colspan", "2");
      await expect(table.locator("tr").nth(1).locator("td")).toHaveCount(2);

      // Colour the merged cell from the submenu, with the keyboard.
      await expect(page.getByRole("menu")).toHaveCount(0);
      await cell(1, 0).click();
      await toolbar.getByRole("button", { name: t.menu.options }).click();
      await page.getByRole("menuitem", { name: t.actions.cellBackground }).focus();
      await page.keyboard.press("ArrowRight");
      await page.getByRole("menuitemradio", { name: t.colors.green }).click();
      await expect(cell(1, 0)).toHaveAttribute("data-background-color", "green");
      const background = await cell(1, 0).evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(background).not.toBe("rgba(0, 0, 0, 0)");

      // Split it back: two 1×1 cells, both green, text kept in the first.
      await expect(page.getByRole("menu")).toHaveCount(0);
      await cell(1, 0).click();
      await toolbar.getByRole("button", { name: t.menu.options }).click();
      await page.getByRole("menuitem", { name: t.actions.splitCell }).click();
      await expect(table.locator("tr").nth(1).locator("td")).toHaveCount(3);
      await expect(cell(1, 0)).toHaveAttribute("colspan", "1");
      await expect(cell(1, 1)).toHaveAttribute("data-background-color", "green");
      expect((await cellTexts(table))[1]).toEqual(["a", "", ""]);
    });

    test("wide tables scroll inside the table on a 360 px screen", async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      const editor = await openEditor(page, locale);
      await insertTable(page, editor, locale);
      const toolbar = page.getByRole("toolbar", { name: t.menu.label });
      for (let i = 0; i < 4; i++) {
        await toolbar.getByRole("button", { name: t.actions.addColumnAfter }).click();
      }
      const wrapper = editor.locator(".tableWrapper").last();
      const { scrollWidth, clientWidth } = await wrapper.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
      expect(scrollWidth).toBeGreaterThan(clientWidth);
      const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(pageWidth).toBeLessThanOrEqual(360);
    });
  });
}
