import type { JSONContent } from "@tiptap/core";
import { Schema } from "@tiptap/pm/model";
import { tableNodes } from "@tiptap/pm/tables";

/**
 * Helpers to build TipTap-shaped tables without depending on the table extension being in the
 * shared schema yet: JSON builders plus a small local ProseMirror schema using the TipTap node
 * names (`tableRow`, `tableCell`, `tableHeader`) on top of prosemirror-tables' specs.
 */

type Inline = string | JSONContent;

export interface CellOptions {
  colspan?: number;
  rowspan?: number;
}

export function p(...children: Inline[]): JSONContent {
  const content = children
    .map((child) => (typeof child === "string" ? { type: "text", text: child } : child))
    .filter((child) => child.type !== "text" || child.text);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

export const br: JSONContent = { type: "hardBreak" };

function makeCell(
  type: "tableCell" | "tableHeader",
  value: string | JSONContent | JSONContent[],
  options: CellOptions,
): JSONContent {
  const content = typeof value === "string" ? [p(value)] : Array.isArray(value) ? value : [value];
  return {
    type,
    attrs: { colspan: options.colspan ?? 1, rowspan: options.rowspan ?? 1, colwidth: null },
    content,
  };
}

/** Body cell; a string becomes one paragraph, JSON is used as the block list. */
export function td(value: string | JSONContent | JSONContent[], options: CellOptions = {}) {
  return makeCell("tableCell", value, options);
}

export function th(value: string | JSONContent | JSONContent[], options: CellOptions = {}) {
  return makeCell("tableHeader", value, options);
}

export function row(...cells: (JSONContent | string)[]): JSONContent {
  return { type: "tableRow", content: cells.map((c) => (typeof c === "string" ? td(c) : c)) };
}

export function table(...rows: JSONContent[]): JSONContent {
  return { type: "table", content: rows };
}

const pmTables = tableNodes({ tableGroup: "block", cellContent: "block+", cellAttributes: {} });

/** Minimal schema with TipTap node names, for `tableNodeToCsv` tests. */
export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    bulletList: { content: "listItem+", group: "block" },
    listItem: { content: "paragraph block*" },
    text: { group: "inline" },
    hardBreak: { inline: true, group: "inline", selectable: false },
    mention: {
      inline: true,
      group: "inline",
      atom: true,
      attrs: { id: { default: null }, label: { default: null } },
    },
    table: { ...pmTables.table, content: "tableRow+" },
    tableRow: { ...pmTables.table_row, content: "(tableCell | tableHeader)*" },
    tableCell: pmTables.table_cell,
    tableHeader: pmTables.table_header,
  },
  marks: { bold: {} },
});
