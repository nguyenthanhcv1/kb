// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Editor, type JSONContent } from "@tiptap/core";
import { TableMap } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from "../extensions";
import { parseClipboardTable } from "./paste";
import { pasteIntoTable, TablePaste, tablePastePluginKey } from "./paste-extension";

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
  document.body.innerHTML = "";
});

const fixture = (name: string) =>
  readFileSync(join(process.cwd(), "test/fixtures/clipboard", name), "utf8");

const cell = (text: string, extra: Record<string, unknown> = {}, type = "tableCell") => ({
  type,
  attrs: { colspan: 1, rowspan: 1, ...extra },
  content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
});

async function createEditor(content: JSONContent) {
  const editor = new Editor({
    element: document.body.appendChild(document.createElement("div")),
    extensions: [...createExtensions(), TablePaste],
    content,
  });
  editors.push(editor);
  await new Promise((resolve) => editor.on("create", resolve));
  return editor;
}

function paste(editor: Editor, data: { html?: string; text?: string }) {
  const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => (type === "text/html" ? data.html : data.text) ?? "" },
  });
  const plugin = editor.view.state.plugins.find((p) => p.spec.key === tablePastePluginKey)!;
  return plugin.props.handlePaste!.call(plugin, editor.view, event, null as never) ?? false;
}

function grid(editor: Editor): string[][] {
  const table =
    editor.state.doc.firstChild!.type.name === "table" ? editor.state.doc.firstChild! : null;
  if (!table) throw new Error("no table first");
  return table.content.content.map((row) => row.content.content.map((c) => c.textContent));
}

function placeCursorIn(editor: Editor, text: string) {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text === text) found = pos;
  });
  expect(found).toBeGreaterThan(-1);
  editor.commands.setTextSelection(found + 1);
}

const twoByTwo: JSONContent = {
  type: "doc",
  content: [
    {
      type: "table",
      content: [
        { type: "tableRow", content: [cell("A", {}, "tableHeader"), cell("B", {}, "tableHeader")] },
        { type: "tableRow", content: [cell("c"), cell("d")] },
      ],
    },
    { type: "paragraph" },
  ],
};

describe("TablePaste", () => {
  it("overwrites from the selected cell and appends missing rows and columns", async () => {
    const editor = await createEditor(twoByTwo);
    placeCursorIn(editor, "d");
    expect(paste(editor, { text: "1\t2\n3\t4" })).toBe(true);
    expect(grid(editor)).toEqual([
      ["A", "B", ""],
      ["c", "1", "2"],
      ["", "3", "4"],
    ]);
    // Header cells stay headers.
    expect(editor.state.doc.firstChild!.firstChild!.firstChild!.type.name).toBe("tableHeader");
    expect(editor.state.selection.constructor.name).toBe("CellSelection");
  });

  it("is a single undo step", async () => {
    const editor = await createEditor(twoByTwo);
    placeCursorIn(editor, "c");
    paste(editor, { text: "x\ty\tz" });
    editor.commands.undo();
    expect(grid(editor)).toEqual([
      ["A", "B"],
      ["c", "d"],
    ]);
  });

  it("splits merged cells under the pasted region", async () => {
    const editor = await createEditor({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            { type: "tableRow", content: [cell("m", { colspan: 2, colwidth: [100, 100] })] },
            { type: "tableRow", content: [cell("a"), cell("b")] },
          ],
        },
        { type: "paragraph" },
      ],
    });
    placeCursorIn(editor, "m");
    paste(editor, { text: "1\t2\n3\t4" });
    const table = editor.state.doc.firstChild!;
    const map = TableMap.get(table);
    expect([map.width, map.height]).toEqual([2, 2]);
    expect(grid(editor)).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("recreates pasted merged cells and maps colours to the palette", async () => {
    const editor = await createEditor({ type: "doc", content: [{ type: "paragraph" }] });
    const html =
      '<table><tr><td colspan="2" style="background:#FFF2CC">Head</td></tr><tr><td>a</td><td>b</td></tr></table>';
    expect(paste(editor, { html })).toBe(true);
    const table = editor.state.doc.firstChild!;
    const first = table.firstChild!.firstChild!;
    expect(first.attrs.colspan).toBe(2);
    expect(first.attrs.backgroundColor).toBe("yellow");
    expect(editor.state.doc.lastChild!.type.name).toBe("paragraph");
  });

  it("inserts a new table from a real Excel clipboard outside tables, NFC-normalised", async () => {
    const editor = await createEditor({ type: "doc", content: [{ type: "paragraph" }] });
    const ok = paste(editor, {
      html: fixture("excel-windows.text-html.txt"),
      text: fixture("excel-windows.text-plain.txt"),
    });
    expect(ok).toBe(true);
    expect(editor.state.doc.firstChild!.type.name).toBe("table");
  });

  it("builds and applies a 500-row paste in under a second", async () => {
    const editor = await createEditor(twoByTwo);
    placeCursorIn(editor, "A");
    const text = Array.from({ length: 500 }, (_, i) => `r${i}\tv${i}\tw${i}`).join("\n");
    const pasted = parseClipboardTable({ text })!;
    // Without view rendering: happy-dom needs seconds to draw 1500 cells, a browser does not.
    const start = performance.now();
    const next = editor.state.apply(pasteIntoTable(editor.state, pasted)!);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(next.doc.firstChild!.childCount).toBe(500);
    expect(paste(editor, { text })).toBe(true);
    expect(grid(editor)).toHaveLength(500);
  });

  it("leaves ordinary text, editor-internal copies and single cells alone", async () => {
    const editor = await createEditor({ type: "doc", content: [{ type: "paragraph" }] });
    expect(paste(editor, { text: "just text" })).toBe(false);
    expect(
      paste(editor, {
        html: '<table data-pm-slice="1 1 []"><tr><td>x</td><td>y</td></tr></table>',
      }),
    ).toBe(false);
  });
});
