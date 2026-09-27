import type { AnyExtension } from "@tiptap/core";
import { Table, TableRow } from "@tiptap/extension-table";

import { TableCellWithAttrs, TableHeaderWithAttrs } from "./cell-attrs";

export {
  CELL_BACKGROUND_ATTR,
  CELL_BACKGROUND_COLORS,
  CELL_BACKGROUND_DATA_ATTR,
  type CellBackgroundColor,
  isCellBackgroundColor,
  nearestCellBackgroundColor,
} from "./cell-attrs";

/**
 * Node names of the table block (ProseMirror `tableRole`s table / row / header_cell / cell).
 * Shared with the extractor, CSV export and the paste parser — never rename them: they are
 * stored in every Yjs document.
 */
export const TABLE_NODE_NAMES = {
  table: "table",
  row: "tableRow",
  header: "tableHeader",
  cell: "tableCell",
} as const;

/** Smallest column width (px) while resizing; also the width of a column without `colwidth`. */
export const TABLE_CELL_MIN_WIDTH = 80;

/** Size of a table inserted from the "/" menu (the first row is a header row). */
export const DEFAULT_TABLE_SIZE = { rows: 3, cols: 3, withHeaderRow: true } as const;

/**
 * Table block (T4.1) from the open-source `@tiptap/extension-table` — no TipTap Pro.
 *
 * - Cells hold blocks (`block+`) and carry `colspan`, `rowspan`, `colwidth` (px widths set by
 *   dragging a column border, stored in the document so they survive reloads and sync over Yjs)
 *   and `align`, plus `backgroundColor` (T4.2, `cell-attrs.ts`: a palette code such as `blue`).
 *   Merging a rectangular cell selection and splitting a merged cell are the prosemirror-tables
 *   commands `mergeCells` / `splitCell`.
 * - Every table node gets a block ID through `BLOCK_ID_TYPES` (deep links to a cell, comments).
 * - Tab / Shift-Tab move between cells; Tab in the last cell appends a row.
 *
 * `resizable` only adds a plugin in editable views; the schema is the same everywhere.
 */
export function createTableExtensions(): AnyExtension[] {
  return [
    Table.configure({
      resizable: true,
      // The resize view wraps each table in `div.tableWrapper` (horizontal scroll on phones);
      // static HTML (read-only rendering, exports) gets the same wrapper.
      renderWrapper: true,
      cellMinWidth: TABLE_CELL_MIN_WIDTH,
      lastColumnResizable: true,
      allowTableNodeSelection: false,
    }),
    TableRow,
    TableHeaderWithAttrs,
    TableCellWithAttrs,
  ];
}
