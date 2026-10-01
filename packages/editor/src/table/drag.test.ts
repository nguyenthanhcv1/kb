// @vitest-environment happy-dom
import { Editor, type JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TableMap } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from "../extensions";
import {
  getDropTargets,
  getMovableSpan,
  moveCurrentLine,
  moveTableLine,
  neighbourBoundary,
  TableDrag,
} from "./drag";

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
  document.body.innerHTML = "";
});

type Cell = string | { text: string; colspan?: number; rowspan?: number; colwidth?: number[] };

function cellJson(cell: Cell, header: boolean): JSONContent {
  const c = typeof cell === "string" ? { text: cell } : cell;
  return {
    type: header ? "tableHeader" : "tableCell",
    attrs: { colspan: c.colspan ?? 1, rowspan: c.rowspan ?? 1, colwidth: c.colwidth ?? null },
    content: [{ type: "paragraph", content: [{ type: "text", text: c.text }] }],
  };
}

function tableJson(rows: Cell[][], headerRow = false): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        content: rows.map((row, r) => ({
          type: "tableRow",
          content: row.map((cell) => cellJson(cell, headerRow && r === 0)),
        })),
      },
      { type: "paragraph" },
    ],
  };
}

async function createEditor(content: JSONContent, extra = false) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [...createExtensions(), ...(extra ? [TableDrag] : [])],
    content,
  });
  editors.push(editor);
  await new Promise((resolve) => editor.on("create", resolve));
  return editor;
}

function table(editor: Editor): { node: ProseMirrorNode; pos: number } {
  return { node: editor.state.doc.child(0), pos: 0 };
}

/** Text grid; a cell covered by a merged cell appears as `null`-free "·" placeholder. */
function grid(node: ProseMirrorNode): string[][] {
  const map = TableMap.get(node);
  const out: string[][] = [];
  for (let r = 0; r < map.height; r++) {
    const row: string[] = [];
    for (let c = 0; c < map.width; c++) {
      const offset = map.map[r * map.width + c]!;
      const rect = map.findCell(offset);
      row.push(rect.top === r && rect.left === c ? node.nodeAt(offset)!.textContent : "·");
    }
    out.push(row);
  }
  return out;
}

function move(editor: Editor, axis: "row" | "column", index: number, dest: number) {
  const { pos } = table(editor);
  const tr = moveTableLine(editor.state, pos, axis, index, dest);
  if (tr) editor.view.dispatch(tr);
  return tr !== null;
}

const abc = [
  ["a1", "b1", "c1"],
  ["a2", "b2", "c2"],
  ["a3", "b3", "c3"],
];

describe("moveTableLine", () => {
  it("moves a row down and up", async () => {
    const editor = await createEditor(tableJson(abc));
    expect(move(editor, "row", 0, 3)).toBe(true);
    expect(grid(table(editor).node)).toEqual([abc[1], abc[2], abc[0]]);
    expect(move(editor, "row", 2, 0)).toBe(true);
    expect(grid(table(editor).node)).toEqual(abc);
  });

  it("moves a column left and right", async () => {
    const editor = await createEditor(tableJson(abc));
    expect(move(editor, "column", 0, 3)).toBe(true);
    expect(grid(table(editor).node)).toEqual(abc.map(([a, b, c]) => [b, c, a]));
    expect(move(editor, "column", 2, 1)).toBe(true);
    expect(grid(table(editor).node)).toEqual(abc.map(([a, b, c]) => [b, a, c]));
  });

  it("refuses no-ops and bad input", async () => {
    const editor = await createEditor(tableJson(abc));
    const before = editor.state.doc;
    expect(move(editor, "row", 1, 1)).toBe(false);
    expect(move(editor, "row", 1, 2)).toBe(false);
    expect(move(editor, "row", 5, 0)).toBe(false);
    expect(move(editor, "column", 0, 9)).toBe(false);
    expect(editor.state.doc.eq(before)).toBe(true);
    expect(moveTableLine(editor.state, 3, "row", 0, 2)).toBeNull();
  });

  it("is one undo step", async () => {
    const editor = await createEditor(tableJson(abc));
    move(editor, "row", 0, 3);
    move(editor, "column", 0, 3);
    editor.commands.undo();
    expect(grid(table(editor).node)).toEqual([abc[1], abc[2], abc[0]]);
    editor.commands.undo();
    expect(grid(table(editor).node)).toEqual(abc);
  });

  it("keeps header cells, block ids and column widths with their cells", async () => {
    const editor = await createEditor(
      tableJson(
        [
          [
            { text: "h1", colwidth: [100] },
            { text: "h2", colwidth: [200] },
          ],
          ["x", "y"],
        ],
        true,
      ),
    );
    const ids = () => {
      const map: Record<string, unknown> = {};
      table(editor).node.descendants((n) => {
        if (n.type.spec.tableRole?.includes("cell")) map[n.textContent] = n.attrs.id;
      });
      return map;
    };
    await new Promise((resolve) => setTimeout(resolve, 0));
    const before = ids();
    expect(Object.values(before).every(Boolean)).toBe(true);
    move(editor, "column", 0, 2);
    move(editor, "row", 0, 2);
    const node = table(editor).node;
    expect(grid(node)).toEqual([
      ["y", "x"],
      ["h2", "h1"],
    ]);
    expect(ids()).toEqual(before);
    expect(node.nodeAt(TableMap.get(node).map[2]!)!.type.name).toBe("tableHeader");
    expect(node.nodeAt(TableMap.get(node).map[3]!)!.attrs.colwidth).toEqual([100]);
    const mapped = TableMap.get(node);
    expect(() => node.check()).not.toThrow();
    expect(mapped.problems).toBeNull();
  });

  it("moves a 20x10 table without losing a cell", async () => {
    const rows = Array.from({ length: 20 }, (_, r) =>
      Array.from({ length: 10 }, (_, c) => `r${r}c${c}`),
    );
    const editor = await createEditor(tableJson(rows));
    expect(move(editor, "row", 3, 18)).toBe(true);
    expect(move(editor, "column", 9, 0)).toBe(true);
    const expected = rows.map((r) => [...r]);
    expected.splice(17, 0, ...expected.splice(3, 1));
    expected.forEach((r) => r.unshift(r.pop()!));
    expect(grid(table(editor).node)).toEqual(expected);
    expect(table(editor).node.check()).toBeUndefined();
  });

  it("puts the caret in the moved row", async () => {
    const editor = await createEditor(tableJson(abc));
    move(editor, "row", 0, 3);
    expect(editor.state.selection.$from.parent.textContent).toBe("a1");
  });
});

describe("merged cells", () => {
  // a1 | b1 (rowspan 2) | c1
  // a2 |  ·             | c2
  // a3 | b3             | c3
  const rowspan = (): Cell[][] => [
    ["a1", { text: "b1", rowspan: 2 }, "c1"],
    ["a2", "c2"],
    ["a3", "b3", "c3"],
  ];
  // wide (colspan 2) | c1 ; a2 | b2 | c2 ; a3 | b3 | c3
  const colspan = (): Cell[][] => [
    [{ text: "w1", colspan: 2, colwidth: [50, 60] }, "c1"],
    ["a2", "b2", "c2"],
    ["a3", "b3", "c3"],
  ];

  it("grows the dragged unit to the whole merged block", async () => {
    const editor = await createEditor(tableJson(rowspan()));
    const { node } = table(editor);
    expect(getMovableSpan(node, "row", 0)).toEqual({ start: 0, end: 2 });
    expect(getMovableSpan(node, "row", 1)).toEqual({ start: 0, end: 2 });
    expect(getMovableSpan(node, "row", 2)).toEqual({ start: 2, end: 3 });
    expect(getMovableSpan(node, "column", 1)).toEqual({ start: 1, end: 2 });
  });

  it("refuses to drop inside a merged cell", async () => {
    const editor = await createEditor(tableJson(rowspan()));
    const { node } = table(editor);
    expect(getDropTargets(node, "row", 2)).toEqual([0]);
    expect(move(editor, "row", 2, 1)).toBe(false);
    expect(move(editor, "row", 0, 3)).toBe(true);
  });

  it("moves the merged block as a whole", async () => {
    const editor = await createEditor(tableJson(rowspan()));
    expect(move(editor, "row", 1, 3)).toBe(true);
    const node = table(editor).node;
    expect(grid(node)).toEqual([
      ["a3", "b3", "c3"],
      ["a1", "b1", "c1"],
      ["a2", "·", "c2"],
    ]);
    expect(TableMap.get(node).problems).toBeNull();
  });

  it("moves columns across a rowspan and keeps colspan widths", async () => {
    const editor = await createEditor(tableJson(rowspan()));
    expect(move(editor, "column", 1, 0)).toBe(true);
    const node = table(editor).node;
    expect(grid(node)).toEqual([
      ["b1", "a1", "c1"],
      ["·", "a2", "c2"],
      ["b3", "a3", "c3"],
    ]);
    expect(TableMap.get(node).problems).toBeNull();
  });

  it("moves a colspan block and refuses a drop inside it", async () => {
    const editor = await createEditor(tableJson(colspan()));
    const { node } = table(editor);
    expect(getMovableSpan(node, "column", 1)).toEqual({ start: 0, end: 2 });
    expect(getDropTargets(node, "column", 2)).toEqual([0]);
    expect(move(editor, "column", 2, 1)).toBe(false);
    expect(move(editor, "column", 0, 3)).toBe(true);
    const moved = table(editor).node;
    expect(grid(moved)).toEqual([
      ["c1", "w1", "·"],
      ["c2", "a2", "b2"],
      ["c3", "a3", "b3"],
    ]);
    expect(moved.nodeAt(TableMap.get(moved).map[1]!)!.attrs.colwidth).toEqual([50, 60]);
    expect(TableMap.get(moved).problems).toBeNull();
  });

  it("moves a plain column past a colspan row", async () => {
    const editor = await createEditor(tableJson(colspan()));
    expect(move(editor, "column", 2, 0)).toBe(true);
    expect(grid(table(editor).node)).toEqual([
      ["c1", "w1", "·"],
      ["c2", "a2", "b2"],
      ["c3", "a3", "b3"],
    ]);
  });
});

describe("keyboard moves", () => {
  it("steps over merged blocks", async () => {
    const editor = await createEditor(
      tableJson([["a1", { text: "b1", rowspan: 2 }], ["a2"], ["a3", "b3"]]),
    );
    const { node } = table(editor);
    expect(neighbourBoundary(node, "row", 2, -1)).toBe(0);
    expect(neighbourBoundary(node, "row", 0, 1)).toBe(3);
    expect(neighbourBoundary(node, "row", 0, -1)).toBeNull();
  });

  it("moves the row of the caret", async () => {
    const editor = await createEditor(tableJson(abc), true);
    editor.commands.setTextSelection(editor.state.doc.resolve(4).pos);
    expect(editor.state.selection.$from.parent.textContent).toBe("a1");
    expect(moveCurrentLine(editor, "row", 1)).toBe(true);
    expect(grid(table(editor).node)[1]).toEqual(abc[0]);
    expect(moveCurrentLine(editor, "column", 1)).toBe(true);
    expect(grid(table(editor).node)[1]).toEqual(["b1", "a1", "c1"]);
    expect(moveCurrentLine(editor, "column", -1)).toBe(true);
    // Already last row / first column: nothing to do.
    expect(moveCurrentLine(editor, "column", -1)).toBe(false);
  });
});

describe("TableDrag plugin", () => {
  it("renders a handle per row and column, only in editable views", async () => {
    const editor = await createEditor(tableJson(abc), true);
    const root = editor.view.dom;
    expect(root.querySelectorAll(".kb-table-handle-row")).toHaveLength(3);
    expect(root.querySelectorAll(".kb-table-handle-column")).toHaveLength(3);
    editor.setEditable(false);
    expect(root.querySelectorAll(".kb-table-handle")).toHaveLength(0);
  });

  it("drags a row with the pointer and previews the drop position", async () => {
    const editor = await createEditor(tableJson(abc), true);
    const root = editor.view.dom as HTMLElement;
    const rows = [...root.querySelectorAll("tr")];
    // happy-dom has no layout: give each row a box (30 px high).
    rows.forEach((tr, i) => {
      const cell = tr.firstElementChild as HTMLElement;
      cell.getBoundingClientRect = () =>
        ({ top: i * 30, bottom: i * 30 + 30, left: 0, right: 100 }) as DOMRect;
    });
    const handle = root.querySelector<HTMLElement>(".kb-table-handle-row")!;
    handle.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
    );
    document.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: 88 }));
    expect(root.querySelectorAll(".kb-drag-source")).toHaveLength(3);
    expect(rows[2]!.querySelector(".kb-drop-after")).not.toBeNull();
    document.dispatchEvent(new PointerEvent("pointerup", {}));
    expect(grid(table(editor).node)).toEqual([abc[1], abc[2], abc[0]]);
    expect(root.querySelector(".kb-drag-source")).toBeNull();
  });

  it("Escape cancels the drag", async () => {
    const editor = await createEditor(tableJson(abc), true);
    const root = editor.view.dom as HTMLElement;
    root.querySelectorAll("tr").forEach((tr, i) => {
      (tr.firstElementChild as HTMLElement).getBoundingClientRect = () =>
        ({ top: i * 30, bottom: i * 30 + 30, left: 0, right: 100 }) as DOMRect;
    });
    root
      .querySelector(".kb-table-handle-row")!
      .dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
      );
    document.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: 88 }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointerup", {}));
    expect(grid(table(editor).node)).toEqual(abc);
  });
});
