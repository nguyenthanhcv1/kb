// @vitest-environment happy-dom
import { Editor, type JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { CellSelection, TableMap } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it } from "vitest";

import {
  CELL_BACKGROUND_COLORS,
  createExtensions,
  getEditorSchema,
  nearestCellBackgroundColor,
} from "../extensions";
import { parseClipboardTable, pastedTableToNode } from "../table/paste";
import {
  getCellBackground,
  getTableMenuState,
  setCellBackground,
  TABLE_ACTIONS,
  type TableActionId,
} from "./index";

const editors: Editor[] = [];

async function createEditor(content: JSONContent | string, editable = true) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({ element, extensions: createExtensions(), content, editable });
  editors.push(editor);
  await new Promise((resolve) => editor.on("create", resolve));
  return editor;
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = "";
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const run = (editor: Editor, id: TableActionId) =>
  TABLE_ACTIONS.find((action) => action.id === id)!.run(editor);

function firstTable(doc: ProseMirrorNode): { node: ProseMirrorNode; pos: number } {
  let result: { node: ProseMirrorNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (!result && node.type.name === "table") result = { node, pos };
    return !result;
  });
  return result!;
}

/** Position before the cell whose text is `text`. */
function cellPos(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.spec.tableRole?.includes("cell") && node.textContent === text) {
      found = pos;
    }
  });
  return found;
}

function selectCells(editor: Editor, from: string, to: string) {
  const { doc } = editor.state;
  const selection = CellSelection.create(doc, cellPos(editor, from), cellPos(editor, to));
  editor.view.dispatch(editor.state.tr.setSelection(selection));
}

function caretIn(editor: Editor, text: string) {
  editor.commands.setTextSelection(cellPos(editor, text) + 2);
}

/** Rows of `text[colspan×rowspan]`, e.g. `a[2×2]`; 1×1 cells are plain text. */
function layout(editor: Editor): string[][] {
  const rows: string[][] = [];
  firstTable(editor.state.doc).node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => {
      const { colspan, rowspan } = cell.attrs as { colspan: number; rowspan: number };
      const text = cell.textContent;
      cells.push(colspan === 1 && rowspan === 1 ? text : `${text}[${colspan}×${rowspan}]`);
    });
    rows.push(cells);
  });
  return rows;
}

function backgrounds(doc: ProseMirrorNode): (string | null)[][] {
  const rows: (string | null)[][] = [];
  firstTable(doc).node.forEach((row) => {
    const cells: (string | null)[] = [];
    row.forEach((cell) => cells.push(cell.attrs.backgroundColor as string | null));
    rows.push(cells);
  });
  return rows;
}

const TABLE_3X3 =
  "<table>" +
  "<tr><td><p>a</p></td><td><p>b</p></td><td><p>c</p></td></tr>" +
  "<tr><td><p>d</p></td><td><p>e</p></td><td><p>f</p></td></tr>" +
  "<tr><td><p>g</p></td><td><p>h</p></td><td><p>i</p></td></tr>" +
  "</table><p>after</p>";

describe("merging and splitting cells", () => {
  it("merges a rectangular cell selection into one cell", async () => {
    const editor = await createEditor(TABLE_3X3);
    caretIn(editor, "a");
    expect(getTableMenuState(editor).enabled.mergeCells).toBe(false);

    selectCells(editor, "a", "e");
    expect(getTableMenuState(editor).enabled.mergeCells).toBe(true);
    expect(run(editor, "mergeCells")).toBe(true);

    const table = firstTable(editor.state.doc).node;
    expect(() => table.check()).not.toThrow();
    const map = TableMap.get(table);
    expect(map.width).toBe(3);
    expect(map.height).toBe(3);
    expect(map.problems).toBeNull();
    const merged = table.firstChild!.firstChild!;
    expect(merged.attrs).toMatchObject({ colspan: 2, rowspan: 2 });
    // Content of every merged cell is kept, in reading order.
    expect(merged.childCount).toBe(4);
    expect(merged.textContent).toBe("abde");
    expect(layout(editor).map((row) => row.length)).toEqual([2, 1, 3]);
  });

  it("merges a whole row, keeping the column widths", async () => {
    const editor = await createEditor(
      "<table><tr><td colwidth='100'><p>a</p></td><td colwidth='150'><p>b</p></td></tr>" +
        "<tr><td><p>c</p></td><td><p>d</p></td></tr></table>",
    );
    selectCells(editor, "a", "b");
    run(editor, "mergeCells");
    const merged = firstTable(editor.state.doc).node.firstChild!.firstChild!;
    expect(merged.attrs).toMatchObject({ colspan: 2, rowspan: 1, colwidth: [100, 150] });
  });

  it("splits a merged cell back into 1×1 cells", async () => {
    const editor = await createEditor(TABLE_3X3);
    selectCells(editor, "a", "e");
    run(editor, "mergeCells");
    await tick();

    caretIn(editor, "abde");
    expect(getTableMenuState(editor).enabled.splitCell).toBe(true);
    expect(run(editor, "splitCell")).toBe(true);
    await tick();

    const table = firstTable(editor.state.doc).node;
    expect(() => table.check()).not.toThrow();
    const map = TableMap.get(table);
    expect(map.problems).toBeNull();
    table.descendants((node) => {
      if (node.type.spec.tableRole === "cell") {
        expect(node.attrs).toMatchObject({ colspan: 1, rowspan: 1 });
      }
      return node.type.name !== "tableCell";
    });
    expect(layout(editor)).toEqual([
      ["abde", "", "c"],
      ["", "", "f"],
      ["g", "h", "i"],
    ]);
    // The new cells get their own block ids (no duplicate of the split cell's id).
    const ids: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "tableCell") ids.push(node.attrs.id as string);
    });
    expect(ids).toHaveLength(9);
    expect(new Set(ids).size).toBe(9);
    // Split is not offered on a 1×1 cell.
    caretIn(editor, "i");
    expect(getTableMenuState(editor).enabled.splitCell).toBe(false);
  });

  it("undoes a merge in one step", async () => {
    const editor = await createEditor(TABLE_3X3);
    selectCells(editor, "d", "i");
    run(editor, "mergeCells");
    expect(layout(editor)[1]).toEqual(["defghi[3×2]"]);
    editor.commands.undo();
    expect(layout(editor)).toEqual([
      ["a", "b", "c"],
      ["d", "e", "f"],
      ["g", "h", "i"],
    ]);
  });

  it("disables merge and split in a read-only editor", async () => {
    const editor = await createEditor(TABLE_3X3, false);
    selectCells(editor, "a", "b");
    const state = getTableMenuState(editor);
    expect(state.enabled.mergeCells).toBe(false);
    expect(state.canSetCellBackground).toBe(false);
    expect(setCellBackground(editor, "blue")).toBe(false);
  });
});

describe("cell background colour", () => {
  it("colours every selected cell, reports mixed selections and clears", async () => {
    const editor = await createEditor(TABLE_3X3);
    caretIn(editor, "a");
    expect(setCellBackground(editor, "yellow")).toBe(true);
    expect(getCellBackground(editor.state)).toBe("yellow");

    // The first cell already has a colour: the rest of the selection still changes.
    selectCells(editor, "a", "e");
    expect(getCellBackground(editor.state)).toBe("mixed");
    expect(getTableMenuState(editor).cellBackground).toBe("mixed");
    setCellBackground(editor, "blue");
    expect(backgrounds(editor.state.doc)).toEqual([
      ["blue", "blue", null],
      ["blue", "blue", null],
      [null, null, null],
    ]);
    expect(getCellBackground(editor.state)).toBe("blue");

    setCellBackground(editor, null);
    expect(
      backgrounds(editor.state.doc)
        .flat()
        .every((c) => c === null),
    ).toBe(true);
    editor.commands.undo();
    expect(backgrounds(editor.state.doc)[0]).toEqual(["blue", "blue", null]);
  });

  it("refuses codes outside the palette", async () => {
    const editor = await createEditor(TABLE_3X3);
    caretIn(editor, "a");
    expect(setCellBackground(editor, "#ff0000" as never)).toBe(false);
    expect(getCellBackground(editor.state)).toBeNull();
  });

  it("keeps the colour when merging (top-left cell) and splitting (every new cell)", async () => {
    const editor = await createEditor(TABLE_3X3);
    caretIn(editor, "a");
    setCellBackground(editor, "green");
    selectCells(editor, "a", "b");
    run(editor, "mergeCells");
    expect(backgrounds(editor.state.doc)[0]).toEqual(["green", null]);
    caretIn(editor, "ab");
    run(editor, "splitCell");
    expect(backgrounds(editor.state.doc)[0]).toEqual(["green", "green", null]);
  });

  it("is stored as a palette code in the schema and JSON", () => {
    const schema = getEditorSchema();
    for (const name of ["tableCell", "tableHeader"]) {
      expect(schema.nodes[name]!.spec.attrs?.backgroundColor).toEqual(
        expect.objectContaining({ default: null }),
      );
    }
    expect(CELL_BACKGROUND_COLORS).toContain("blue");
  });
});

describe("colour round trips", () => {
  const COLORED: JSONContent = {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                attrs: { backgroundColor: "purple" },
                content: [{ type: "paragraph", content: [{ type: "text", text: "H" }] }],
              },
              {
                type: "tableHeader",
                content: [{ type: "paragraph", content: [{ type: "text", text: "I" }] }],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                attrs: { backgroundColor: "blue", colspan: 2 },
                content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
              },
            ],
          },
        ],
      },
    ],
  };

  it("survives getJSON / setContent", async () => {
    const editor = await createEditor(COLORED);
    const json = editor.getJSON();
    const other = await createEditor("<p></p>");
    other.commands.setContent(json);
    expect(backgrounds(other.state.doc)).toEqual([["purple", null], ["blue"]]);
    expect(layout(other)[1]).toEqual(["x[2×1]"]);
  });

  it("renders data-background-color and parses it back from HTML", async () => {
    const editor = await createEditor(COLORED);
    const html = editor.getHTML();
    expect(html).toContain('data-background-color="purple"');
    expect(html).toContain('data-background-color="blue"');
    expect(html).not.toMatch(/data-background-color="(null|)"/);
    // No colour value in the HTML: the theme decides how a code looks.
    expect(html).not.toMatch(/background(-color)?:/);

    const other = await createEditor(html);
    expect(backgrounds(other.state.doc)).toEqual([["purple", null], ["blue"]]);
  });

  it("survives an internal copy/paste of a cell selection", async () => {
    const editor = await createEditor(COLORED);
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.spec.tableRole?.includes("cell")) cells.push(pos);
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[0]!, cells[2]!)),
    );
    const { dom } = editor.view.serializeForClipboard(editor.state.selection.content());
    expect(dom.innerHTML).toContain('data-background-color="blue"');

    const target = await createEditor("<p>here</p>");
    target.commands.setTextSelection(1);
    target.view.pasteHTML(dom.innerHTML);
    expect(backgrounds(target.state.doc)).toEqual([["purple", null], ["blue"]]);
  });

  it("drops unknown codes and maps inline colours from other apps to the palette", async () => {
    const editor = await createEditor(
      '<table><tr><td data-background-color="neon"><p>a</p></td>' +
        '<td style="background-color: #FFF2CC"><p>b</p></td>' +
        '<td bgcolor="#c6efce"><p>c</p></td>' +
        '<td style="background-color: rgb(255, 255, 255)"><p>d</p></td></tr></table>',
    );
    expect(backgrounds(editor.state.doc)).toEqual([[null, "yellow", "green", null]]);
  });

  it("feeds the spreadsheet paste parser (T4.4a) through backgroundColor", () => {
    const pasted = parseClipboardTable({
      html:
        "<table><tr><td style='background:#FFFF00'>a</td><td>b</td></tr>" +
        "<tr><td bgcolor='#DDEBF7' colspan='2'>c</td></tr></table>",
    })!;
    const node = pastedTableToNode(pasted, getEditorSchema(), {
      mapBackground: nearestCellBackgroundColor,
    })!;
    expect(backgrounds(node.type.schema.topNodeType.create(null, node))).toEqual([
      ["yellow", null],
      ["blue"],
    ]);
  });
});

describe("nearestCellBackgroundColor", () => {
  it.each([
    ["#ffff00", "yellow"],
    ["#fff2cc", "yellow"],
    ["#c6efce", "green"],
    ["#ddebf7", "blue"],
    ["#ffc7ce", "red"],
    ["#f4b084", "orange"],
    ["#e4dfec", "purple"],
    ["#ff66cc", "pink"],
    ["#808080", "gray"],
    ["#d9d9d9", "gray"],
    ["#000000", "gray"],
  ])("%s → %s", (hex, code) => {
    expect(nearestCellBackgroundColor(hex)).toBe(code);
  });

  it("returns null for anything that is not a hex colour", () => {
    expect(nearestCellBackgroundColor("blue")).toBeNull();
  });
});
