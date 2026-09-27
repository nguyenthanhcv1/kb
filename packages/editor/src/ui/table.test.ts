// @vitest-environment happy-dom
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createExtensions, getEditorSchema } from "../extensions";
import { extractContent } from "../extract";
import { CSV_BOM } from "../table/csv";
import {
  addRowBelow,
  findTable,
  getTableMenuState,
  hasHeaderColumn,
  hasHeaderRow,
  runSlashItem,
  SlashCommand,
  SLASH_ITEMS,
  TABLE_ACTIONS,
  type TableActionId,
  tableCsvExport,
  TableShortcuts,
} from "./index";

const editors: Editor[] = [];

async function createEditor(
  content: JSONContent | string,
  extra: Editor["extensionManager"]["extensions"] = [],
  editable = true,
) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [...createExtensions(), ...extra],
    content,
    editable,
  });
  editors.push(editor);
  await new Promise((resolve) => editor.on("create", resolve));
  return editor;
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = "";
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Position just inside the first text node equal to `text`. */
function posOf(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text === text) found = pos + 1;
  });
  return found;
}

/** Table as a grid of cell texts, header cells marked with `#`. */
function grid(editor: Editor): string[][] {
  const table = findTable(editor.state) ?? firstTable(editor);
  if (!table) return [];
  const rows: string[][] = [];
  table.node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) =>
      cells.push((cell.type.name === "tableHeader" ? "#" : "") + cell.textContent),
    );
    rows.push(cells);
  });
  return rows;
}

function firstTable(editor: Editor) {
  let result: ReturnType<typeof findTable> = null;
  editor.state.doc.descendants((node, pos) => {
    if (!result && node.type.name === "table") result = { node, pos, start: pos + 1 };
  });
  return result;
}

const currentCellText = (editor: Editor) => editor.state.selection.$from.parent.textContent;

function press(editor: Editor, key: string, init: KeyboardEventInit = {}) {
  return editor.view.someProp("handleKeyDown", (f) =>
    f(editor.view, new KeyboardEvent("keydown", { key, ...init })),
  );
}

const TABLE_2X2 =
  "<table><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></table><p>after</p>";

const run = (editor: Editor, id: TableActionId) =>
  TABLE_ACTIONS.find((action) => action.id === id)!.run(editor);

describe("inserting a table", () => {
  it("inserts a 3×3 table with a header row from the slash menu, caret in the first cell", async () => {
    const editor = await createEditor("<p>/table</p>");
    const item = SLASH_ITEMS.find((i) => i.id === "table")!;
    expect(runSlashItem({ editor, range: { from: 1, to: 7 }, item })).toBe(true);

    expect(grid(editor)).toEqual([
      ["#", "#", "#"],
      ["", "", ""],
      ["", "", ""],
    ]);
    expect(editor.getJSON().content?.[0]?.type).toBe("table");
    expect(findTable(editor.state)).not.toBeNull();
    expect(editor.state.selection.$from.node(-1).type.name).toBe("tableHeader");
    // A paragraph after the table keeps the caret able to leave it.
    expect(editor.state.doc.lastChild?.type.name).toBe("paragraph");
    expect(editor.getText()).not.toContain("/table");
  });

  it("gives the table, rows and cells stable, unique block ids", async () => {
    const editor = await createEditor("<p>/t</p>");
    const item = SLASH_ITEMS.find((i) => i.id === "table")!;
    runSlashItem({ editor, range: { from: 1, to: 3 }, item });
    await tick();
    const ids: string[] = [];
    const types = new Set<string>();
    editor.state.doc.descendants((node) => {
      if (node.type.name.startsWith("table")) {
        ids.push(node.attrs.id as string);
        types.add(node.type.name);
      }
    });
    expect(types).toEqual(new Set(["table", "tableRow", "tableHeader", "tableCell"]));
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not offer a table inside a table", async () => {
    const onUpdate = vi.fn();
    const editor = await createEditor(TABLE_2X2, [
      SlashCommand.configure({ render: () => ({ onUpdate, onStart: onUpdate }) }),
    ]);
    editor.commands.setTextSelection(posOf(editor, "d") + 1);
    editor.view.dispatch(editor.state.tr.insertText(" /"));
    await tick();
    const ids = onUpdate.mock.lastCall?.[0].items.map((i: { id: string }) => i.id);
    expect(ids).toContain("paragraph");
    expect(ids).not.toContain("table");

    const item = SLASH_ITEMS.find((i) => i.id === "table")!;
    expect(item.available?.(editor.state)).toBe(false);
  });
});

describe("table menu state", () => {
  it("is inactive and disabled outside a table", async () => {
    const editor = await createEditor(TABLE_2X2);
    editor.commands.setTextSelection(posOf(editor, "after"));
    const state = getTableMenuState(editor);
    expect(state.inTable).toBe(false);
    expect(Object.values(state.enabled).every((enabled) => !enabled)).toBe(true);
  });

  it("enables every action inside a table with room to delete", async () => {
    const editor = await createEditor(TABLE_2X2);
    editor.commands.setTextSelection(posOf(editor, "d"));
    const state = getTableMenuState(editor);
    expect(state.inTable).toBe(true);
    expect(Object.keys(state.enabled).sort()).toEqual(TABLE_ACTIONS.map((a) => a.id).sort());
    // Merge needs a multi-cell selection, split a merged cell (see table-cells.test.ts).
    const { mergeCells, splitCell, ...rest } = state.enabled;
    expect(Object.values(rest).every(Boolean)).toBe(true);
    expect({ mergeCells, splitCell }).toEqual({ mergeCells: false, splitCell: false });
    expect(state.checked).toEqual({ headerRow: true, headerColumn: false });
    expect(state.cellBackground).toBeNull();
    expect(state.canSetCellBackground).toBe(true);
  });

  it("cannot delete the last row or the last column", async () => {
    const editor = await createEditor("<table><tr><td><p>x</p></td></tr></table>");
    editor.commands.setTextSelection(posOf(editor, "x"));
    const { enabled } = getTableMenuState(editor);
    expect(enabled.deleteRow).toBe(false);
    expect(enabled.deleteColumn).toBe(false);
    expect(enabled.addRowAfter).toBe(true);
    expect(enabled.deleteTable).toBe(true);
  });

  it("disables everything in a read-only editor", async () => {
    const editor = await createEditor(TABLE_2X2, [], false);
    editor.commands.setTextSelection(posOf(editor, "d"));
    const state = getTableMenuState(editor);
    expect(state.inTable).toBe(true);
    expect(Object.values(state.enabled).some(Boolean)).toBe(false);
  });
});

describe("table actions", () => {
  it("adds rows above and below the current cell", async () => {
    const editor = await createEditor(TABLE_2X2);
    editor.commands.setTextSelection(posOf(editor, "c"));
    expect(run(editor, "addRowBefore")).toBe(true);
    expect(grid(editor)).toEqual([
      ["#A", "#B"],
      ["", ""],
      ["c", "d"],
    ]);

    editor.commands.setTextSelection(posOf(editor, "c"));
    expect(run(editor, "addRowAfter")).toBe(true);
    expect(grid(editor)).toEqual([
      ["#A", "#B"],
      ["", ""],
      ["c", "d"],
      ["", ""],
    ]);
    // "Insert row below" moves the caret into the new row, same column.
    const $from = editor.state.selection.$from;
    expect($from.node(-2).type.name).toBe("tableRow");
    expect($from.index(-3)).toBe(3);
    expect($from.index(-2)).toBe(0);
  });

  it("adds columns left and right, and deletes rows and columns", async () => {
    const editor = await createEditor(TABLE_2X2);
    editor.commands.setTextSelection(posOf(editor, "d"));
    run(editor, "addColumnAfter");
    expect(grid(editor)).toEqual([
      ["#A", "#B", "#"],
      ["c", "d", ""],
    ]);
    editor.commands.setTextSelection(posOf(editor, "c"));
    run(editor, "addColumnBefore");
    expect(grid(editor)).toEqual([
      ["#", "#A", "#B", "#"],
      ["", "c", "d", ""],
    ]);

    editor.commands.setTextSelection(posOf(editor, "c"));
    expect(run(editor, "deleteColumn")).toBe(true);
    expect(grid(editor)).toEqual([
      ["#", "#B", "#"],
      ["", "d", ""],
    ]);
    editor.commands.setTextSelection(posOf(editor, "d"));
    expect(run(editor, "deleteRow")).toBe(true);
    expect(grid(editor)).toEqual([["#", "#B", "#"]]);
    expect(findTable(editor.state)).not.toBeNull();
  });

  it("toggles the header row and header column", async () => {
    const editor = await createEditor(TABLE_2X2);
    editor.commands.setTextSelection(posOf(editor, "d"));
    run(editor, "toggleHeaderRow");
    expect(grid(editor)).toEqual([
      ["A", "B"],
      ["c", "d"],
    ]);
    expect(getTableMenuState(editor).checked.headerRow).toBe(false);

    run(editor, "toggleHeaderColumn");
    expect(grid(editor)).toEqual([
      ["#A", "B"],
      ["#c", "d"],
    ]);
    expect(getTableMenuState(editor).checked).toEqual({ headerRow: false, headerColumn: true });

    run(editor, "toggleHeaderRow");
    const table = findTable(editor.state)!.node;
    expect(hasHeaderRow(table)).toBe(true);
    expect(hasHeaderColumn(table)).toBe(true);
  });

  it("deletes the whole table", async () => {
    const editor = await createEditor(TABLE_2X2);
    editor.commands.setTextSelection(posOf(editor, "c"));
    expect(run(editor, "deleteTable")).toBe(true);
    expect(JSON.stringify(editor.getJSON())).not.toContain('"table"');
    expect(editor.getText()).toContain("after");
  });

  it("keeps column widths (colwidth) in the document", async () => {
    const editor = await createEditor(TABLE_2X2);
    editor.commands.setTextSelection(posOf(editor, "A"));
    editor.commands.setCellAttribute("colwidth", [180]);
    const json: JSONContent = editor.getJSON();
    const header = json.content?.[0]?.content?.[0]?.content?.[0];
    expect(header?.attrs?.colwidth).toEqual([180]);
    // Survives a reload through the shared schema (what kb-collab stores).
    const reloaded = getEditorSchema().nodeFromJSON(json);
    expect(reloaded.firstChild?.firstChild?.firstChild?.attrs.colwidth).toEqual([180]);
  });
});

describe("keyboard", () => {
  it("moves between cells with Tab / Shift-Tab and adds a row after the last cell", async () => {
    const editor = await createEditor(TABLE_2X2);
    editor.commands.setTextSelection(posOf(editor, "A"));
    press(editor, "Tab");
    expect(currentCellText(editor)).toBe("B");
    press(editor, "Tab");
    expect(currentCellText(editor)).toBe("c");
    press(editor, "Tab", { shiftKey: true });
    expect(currentCellText(editor)).toBe("B");

    editor.commands.setTextSelection(posOf(editor, "d"));
    press(editor, "Tab");
    expect(grid(editor)).toHaveLength(3);
    expect(editor.state.selection.$from.index(-3)).toBe(2);
  });

  it("inserts a row below with Mod-Enter and opens the menu with Alt-F10, only in tables", async () => {
    const onMenuShortcut = vi.fn(() => true);
    const editor = await createEditor(TABLE_2X2, [TableShortcuts.configure({ onMenuShortcut })]);
    editor.commands.setTextSelection(posOf(editor, "after"));
    press(editor, "F10", { altKey: true });
    expect(onMenuShortcut).not.toHaveBeenCalled();

    editor.commands.setTextSelection(posOf(editor, "B"));
    press(editor, "F10", { altKey: true });
    expect(onMenuShortcut).toHaveBeenCalledOnce();

    press(editor, "Enter", { ctrlKey: true });
    expect(grid(editor)).toEqual([
      ["#A", "#B"],
      ["", ""],
      ["c", "d"],
    ]);
    expect(editor.state.selection.$from.index(-3)).toBe(1);
    expect(editor.state.selection.$from.index(-2)).toBe(1);
  });

  it("addRowBelow does nothing outside a table", async () => {
    const editor = await createEditor("<p>x</p>");
    expect(addRowBelow(editor)).toBe(false);
  });
});

describe("CSV export and search text", () => {
  it("exports the table holding the selection with a safe file name", async () => {
    const editor = await createEditor(
      "<table><tr><th><p>Mã</p></th><th><p>Ghi chú</p></th></tr><tr><td><p>1</p></td><td><p>a, b</p></td></tr></table>",
    );
    editor.commands.setTextSelection(posOf(editor, "1"));
    const result = tableCsvExport(editor.state, "Báo cáo", new Date("2026-09-26T03:00:00Z"));
    expect(result).toEqual({
      csv: `${CSV_BOM}Mã,Ghi chú\r\n1,"a, b"`,
      fileName: "Bao cao 2026-09-26.csv",
    });
  });

  it("returns null outside a table", async () => {
    const editor = await createEditor(TABLE_2X2);
    editor.commands.setTextSelection(posOf(editor, "after"));
    expect(tableCsvExport(editor.state, "x")).toBeNull();
  });

  it("feeds editor-made tables to the search extractor", async () => {
    const editor = await createEditor(TABLE_2X2);
    editor.commands.setTextSelection(posOf(editor, "d"));
    run(editor, "addRowAfter");
    editor.commands.insertContent("Nguyễn Văn A");
    const result = extractContent(editor.getJSON());
    expect(result.tableText).toBe("A | B\nc | d\n | Nguyễn Văn A");
    expect(result.contentText).toBe("after");
  });
});
