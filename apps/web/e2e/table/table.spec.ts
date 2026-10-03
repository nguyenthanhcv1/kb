import { type Locator, type Page } from "@playwright/test";

import {
  contextAs,
  type EditorFixture,
  expect,
  newLine,
  test,
  waitForEditor,
  waitForSaved,
} from "../support/editor";
import { supabaseEnv } from "../support/env";

/**
 * T4.1 / T7.1c — tables in the editor: insert from "/", type with Tab, add / delete rows and
 * columns from the table toolbar, drag rows and columns, resize, merge / split / colour cells,
 * paste spreadsheet data, export CSV, horizontal scroll on a phone, kept after a reload, hidden
 * from a viewer. Runs in the language of the run (`E2E_LOCALE=vi|en`); labels come from the message
 * files. Each test creates its own Space and page (support/editor).
 */
test.skip(
  !process.env.E2E_STORAGE_STATE,
  "E2E_STORAGE_STATE is not set (signed-in internal user, see T7.1b)",
);
// The worker's signed-in user (playwright.config.ts points it at e2e-w<N>@kb.test).
test.use({ storageState: process.env.E2E_STORAGE_STATE });

/** Inserts a table on a new line at the end of the document with the "/" menu. */
async function insertTable(page: Page, editor: Locator, m: EditorFixture["m"]) {
  await newLine(page, editor);
  await page.keyboard.type("/");
  await page
    .getByRole("option", { name: new RegExp(m.editor.slash.items.table.title) })
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

test("insert a table, type across cells, add rows and columns", async ({ page, doc }) => {
  const {
    editor,
    m: { table: t },
  } = doc;
  const table = await insertTable(page, editor, doc.m);

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

test("paste spreadsheet data: new table, then overwrite and extend it (T4.4b)", async ({
  page,
  doc,
}) => {
  const { editor } = doc;
  await newLine(page, editor);

  const paste = (text: string, html?: string) =>
    page.evaluate(
      ({ text, html }) => {
        const data = new DataTransfer();
        data.setData("text/plain", text);
        if (html) data.setData("text/html", html);
        document.activeElement?.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
        );
      },
      { text, html },
    );

  // Excel-like HTML with a merged, coloured header cell → a new table.
  await paste(
    "Quý 1\t\nA\t1",
    '<table><tr><td colspan="2" style="background:#FFF2CC">Quý 1</td></tr><tr><td>A</td><td>1</td></tr></table>',
  );
  const table = editor.locator("table").last();
  await expect(table.locator("tr")).toHaveCount(2);
  await expect(table.locator("td[colspan='2'][data-background-color='yellow']")).toHaveCount(1);

  // Plain TSV from the last cell: overwrites it and appends the rows / columns it lacks.
  await table.locator("tr").last().locator("td").last().click();
  // History groups edits made within 500 ms: wait so the second paste is its own undo step.
  await page.waitForTimeout(600);
  await paste("x\ty\nz\tw");
  expect((await cellTexts(table)).slice(1)).toEqual([
    ["A", "x", "y"],
    ["", "z", "w"],
  ]);

  // One undo reverts the whole paste.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(table.locator("tr")).toHaveCount(2);
});

test("export the table as CSV", async ({ page, doc }) => {
  const {
    editor,
    m: { table: t },
  } = doc;
  const table = await insertTable(page, editor, doc.m);
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

test("keyboard: Alt+F10 opens the table toolbar, Escape goes back", async ({ page, doc }) => {
  const {
    editor,
    m: { table: t },
  } = doc;
  await insertTable(page, editor, doc.m);
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

test("select cells, merge, colour and split them (T4.2)", async ({ page, doc }) => {
  const {
    editor,
    m: { table: t },
  } = doc;
  const table = await insertTable(page, editor, doc.m);
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

test("drag a row and a column by their handles, undo in one step (T4.3)", async ({ page, doc }) => {
  const {
    editor,
    m: { table: t },
  } = doc;
  const table = await insertTable(page, editor, doc.m);
  for (const text of ["A", "B", "C", "1", "2", "3"]) {
    await page.keyboard.type(text);
    await page.keyboard.press("Tab");
  }
  const before = await cellTexts(table);

  const rowHandles = table.locator(`button[aria-label="${t.drag.row}"]`);
  const columnHandles = table.locator(`button[aria-label="${t.drag.column}"]`);
  await expect(rowHandles).toHaveCount(3);
  await expect(columnHandles).toHaveCount(3);

  await page.waitForTimeout(600);

  // Row 2 above the header row.
  await table.hover();
  const handle = (await rowHandles.nth(1).boundingBox())!;
  const target = (await table.locator("tr").first().boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 20, target.y + 2, { steps: 8 });
  await expect(table.locator(".kb-drop-before").first()).toBeVisible();
  await page.mouse.up();
  expect(await cellTexts(table)).toEqual([before[1], before[0], before[2]]);

  // History groups edits made within 500 ms: pause so every step below is its own undo step.
  await page.waitForTimeout(600);

  // Column 3 to the front (keyboard: Ctrl/Cmd+Alt+Shift+Left from a cell of that column).
  await table.locator("tr").nth(1).locator("th, td").nth(2).locator("p").click();
  await page.keyboard.press("ControlOrMeta+Alt+Shift+ArrowLeft");
  await expect
    .poll(async () => (await cellTexts(table))[1])
    .toEqual([before[0]![0], before[0]![2], before[0]![1]]);

  await page.waitForTimeout(600);

  // Undo reverts the column move alone, then the row move.
  await page.keyboard.press("ControlOrMeta+z");
  expect((await cellTexts(table))[1]).toEqual(before[0]);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await cellTexts(table)).toEqual(before);
});

test("wide tables scroll inside the table on a 360 px screen", async ({ page, doc }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const {
    editor,
    m: { table: t },
  } = doc;
  await insertTable(page, editor, doc.m);
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

test("delete a row, a column and the whole table", async ({ page, doc }) => {
  const {
    editor,
    m: { table: t },
  } = doc;
  const table = await insertTable(page, editor, doc.m);
  const toolbar = page.getByRole("toolbar", { name: t.menu.label });
  const choose = async (name: string) => {
    await toolbar.getByRole("button", { name: t.menu.options }).click();
    await page.getByRole("menuitem", { name }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
  };

  await choose(t.actions.deleteRow);
  await expect(table.locator("tr")).toHaveCount(2);
  await choose(t.actions.deleteColumn);
  await expect(table.locator("tr").first().locator("th, td")).toHaveCount(2);
  await choose(t.actions.deleteTable);
  await expect(editor.locator("table")).toHaveCount(0);
});

test("resize a column by dragging its border", async ({ page, doc }) => {
  const { editor } = doc;
  const table = await insertTable(page, editor, doc.m);
  const cell = table.locator("tr").first().locator("th").first();
  const before = (await cell.boundingBox())!;

  // The resize handle sits on the right border of the cell, a few pixels wide.
  const x = before.x + before.width - 2;
  const y = before.y + before.height / 2;
  await page.mouse.move(x, y);
  // prosemirror-tables puts the class on the editor element (view.dom), not on the table.
  await expect(editor).toHaveClass(/resize-cursor/);
  await page.mouse.down();
  await page.mouse.move(x + 80, y, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(async () => (await cell.boundingBox())!.width)
    .toBeGreaterThan(before.width + 40);
  await expect(cell).toHaveAttribute("colwidth", /^\d+$/);
});

test("the table and its content are saved and still there after a reload", async ({
  page,
  doc,
}) => {
  const {
    editor,
    m: { table: t },
  } = doc;
  const table = await insertTable(page, editor, doc.m);
  for (const text of ["Cot A", "Cot B", "Cot C", "1", "2", "3"]) {
    await page.keyboard.type(text);
    await page.keyboard.press("Tab");
  }
  const toolbar = page.getByRole("toolbar", { name: t.menu.label });
  await toolbar.getByRole("button", { name: t.actions.addRowAfter }).click();
  await expect(table.locator("tr")).toHaveCount(4);
  const before = await cellTexts(table);
  await waitForSaved(page);

  await page.reload();
  const reloaded = await waitForEditor(page, doc.locale);
  const again = reloaded.locator("table").last();
  await expect(again.locator("tr")).toHaveCount(4);
  expect(await cellTexts(again)).toEqual(before);
  await expect(again.locator("tr").first().locator("th")).toHaveCount(3);
});

test("a viewer sees the table but gets no table tools", async ({ page, doc, browser }) => {
  test.skip(!supabaseEnv(), "E2E_SUPABASE_* is not set (needed to create the viewer)");
  const {
    editor,
    m: { table: t },
  } = doc;
  const table = await insertTable(page, editor, doc.m);
  await page.keyboard.type("Chi doc");
  await waitForSaved(page);
  await expect(table.locator("th").first()).toHaveText("Chi doc");

  const context = await contextAs(browser, doc.spaceSlug, "viewer", doc.locale);
  try {
    const viewer = await context.newPage();
    await viewer.goto(doc.pagePath);
    const readOnly = viewer.getByRole("textbox", { name: doc.m.editor.content.label });
    await expect(readOnly.locator("table th").first()).toHaveText("Chi doc");
    await expect(readOnly).toHaveAttribute("contenteditable", "false");
    await readOnly.locator("table th").first().click();
    await expect(viewer.getByRole("toolbar", { name: t.menu.label })).toHaveCount(0);
    await expect(readOnly.locator("button[aria-label]")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
