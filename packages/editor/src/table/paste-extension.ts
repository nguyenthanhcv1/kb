import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { CellSelection, TableMap } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";

import { BLOCK_ID_TYPES, SKIP_UNIQUE_ID_META } from "../extensions";
import { nearestCellBackgroundColor, TABLE_NODE_NAMES } from "../extensions/table";
import {
  type HtmlParser,
  parseClipboardTable,
  type PastedTable,
  pastedTableToNode,
  planTablePaste,
} from "./paste";

/**
 * Paste from Excel / Google Sheets / LibreOffice / TSV into the editor (T4.4b), on top of the
 * pure parser of T4.4a (`paste.ts`):
 *
 * - cursor outside a table → the clipboard becomes a new table at the cursor;
 * - cursor (or cell selection) inside a table → the pasted grid overwrites the cells from the
 *   selected cell on, appending the rows / columns the table is missing. Merged cells touching
 *   the region are split first; pasted merged cells are recreated. Existing cells keep their
 *   block ID, alignment and column width; header cells stay header cells;
 * - a single pasted cell is inserted as plain text; copies made inside the editor
 *   (`data-pm-slice`) and code blocks keep ProseMirror's own paste.
 *
 * The whole paste is one transaction, so undo (and the Yjs undo manager) reverts it at once.
 */

export const tablePastePluginKey = new PluginKey("tablePaste");

export interface TablePasteOptions {
  /** HTML parser for the clipboard payload. Default: the browser's `DOMParser`. */
  parseHtml?: HtmlParser;
}

interface Slot {
  /** Existing cell (kept attributes) or a freshly created one. */
  node: ProseMirrorNode;
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
}

function isTable(node: ProseMirrorNode | null | undefined): node is ProseMirrorNode {
  return node?.type.spec.tableRole === "table";
}

/** Innermost table around `$pos`. */
function tableAround(state: EditorState): { node: ProseMirrorNode; pos: number } | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (isTable(node)) return { node, pos: $from.before(depth) };
  }
  return null;
}

const ID_TYPES: ReadonlySet<string> = new Set(BLOCK_ID_TYPES);

/**
 * Gives every block that lacks one a stable ID (UniqueID does the same in `appendTransaction`,
 * but one `setNodeMarkup` step per block takes seconds for a few thousand cells; creating the
 * nodes with their ID keeps a 500-row paste fast).
 */
function withBlockIds(node: ProseMirrorNode): ProseMirrorNode {
  if (node.isText || node.isLeaf) return node;
  const children: ProseMirrorNode[] = [];
  node.content.forEach((child) => children.push(withBlockIds(child)));
  const needsId =
    ID_TYPES.has(node.type.name) && node.type.spec.attrs?.id !== undefined && !node.attrs.id;
  return node.type.create(
    needsId ? { ...node.attrs, id: crypto.randomUUID() } : node.attrs,
    children,
    node.marks,
  );
}

function emptyCell(state: EditorState, type: ProseMirrorNode["type"]): ProseMirrorNode {
  const cell = type.createAndFill();
  if (!cell) throw new Error("cannot create an empty table cell");
  return cell;
}

/**
 * Writes `pasted` into the table around the selection, starting at the selected cell.
 * Returns the transaction or `null` when the selection is not in a table cell.
 */
export function pasteIntoTable(state: EditorState, pasted: PastedTable): Transaction | null {
  const found = tableAround(state);
  if (!found) return null;
  const { node: table, pos: tablePos } = found;
  const map = TableMap.get(table);
  const tableStart = tablePos + 1;
  const schema = state.schema;
  const cellType = schema.nodes[TABLE_NODE_NAMES.cell]!;

  // Anchor: top-left of the selected cells, or the cell holding the cursor.
  const sel = state.selection;
  let anchorPos: number;
  if (sel instanceof CellSelection) {
    const a = map.findCell(sel.$anchorCell.pos - tableStart);
    const h = map.findCell(sel.$headCell.pos - tableStart);
    anchorPos = map.map[Math.min(a.top, h.top) * map.width + Math.min(a.left, h.left)]!;
  } else {
    const $from = sel.$from;
    let cellPos = -1;
    for (let depth = $from.depth; depth > 0; depth--) {
      const role = $from.node(depth).type.spec.tableRole;
      if (role === "cell" || role === "header_cell") {
        cellPos = $from.before(depth) - tableStart;
        break;
      }
    }
    if (cellPos < 0) return null;
    anchorPos = cellPos;
  }
  const anchor = map.findCell(anchorPos);

  const existing = new Map<number, Slot>();
  const cells: NonNullable<Parameters<typeof planTablePaste>[0]["cells"]>[number][] = [];
  for (const offset of new Set(map.map)) {
    const rect = map.findCell(offset);
    const node = table.nodeAt(offset)!;
    existing.set(offset, {
      node,
      row: rect.top,
      col: rect.left,
      rowspan: rect.bottom - rect.top,
      colspan: rect.right - rect.left,
    });
    cells.push({
      row: rect.top,
      col: rect.left,
      rowspan: rect.bottom - rect.top,
      colspan: rect.right - rect.left,
    });
  }

  const plan = planTablePaste(
    { rowCount: map.height, colCount: map.width, cells },
    { row: anchor.top, col: anchor.left },
    pasted,
  );
  const { region } = plan;

  const pastedNode = pastedTableToNode(pasted, schema, {
    columnWidths: false,
    mapBackground: nearestCellBackgroundColor,
  });
  if (!pastedNode) return null;
  const pastedMap = TableMap.get(pastedNode);

  // owner[r][c] → the slot covering the grid position.
  const owner: (Slot | null)[][] = Array.from({ length: plan.rowCount }, () =>
    Array.from({ length: plan.colCount }, () => null),
  );
  const place = (slot: Slot) => {
    for (let r = slot.row; r < slot.row + slot.rowspan; r++) {
      for (let c = slot.col; c < slot.col + slot.colspan; c++) owner[r]![c] = slot;
    }
  };

  const splitSet = new Set(plan.cellsToSplit.map((c) => `${c.row}:${c.col}`));
  for (const slot of existing.values()) {
    if (!splitSet.has(`${slot.row}:${slot.col}`)) {
      place(slot);
      continue;
    }
    // Split a merged cell the paste touches: content stays top-left, the rest become empty.
    const widths = slot.node.attrs.colwidth as number[] | null | undefined;
    for (let r = slot.row; r < slot.row + slot.rowspan; r++) {
      for (let c = slot.col; c < slot.col + slot.colspan; c++) {
        const first = r === slot.row && c === slot.col;
        const w = widths?.[c - slot.col];
        const attrs = {
          ...slot.node.attrs,
          colspan: 1,
          rowspan: 1,
          colwidth: typeof w === "number" ? [w] : null,
          ...(first ? {} : { id: null }),
        };
        const node = first
          ? slot.node.type.create(attrs, slot.node.content, slot.node.marks)
          : slot.node.type.createAndFill({ ...attrs, backgroundColor: null })!;
        place({ node, row: r, col: c, rowspan: 1, colspan: 1 });
      }
    }
  }

  // Original (pre-split) 1×1 attributes at a grid position, for reuse by pasted cells.
  const oldAt = (r: number, c: number): ProseMirrorNode | null => {
    if (r >= map.height || c >= map.width) return null;
    const slot = existing.get(map.map[r * map.width + c]!);
    return slot && slot.rowspan === 1 && slot.colspan === 1 ? slot.node : null;
  };
  const rowTypeAt = (r: number): ProseMirrorNode["type"] => {
    if (r < map.height) return table.nodeAt(map.map[r * map.width]!)!.type;
    return cellType;
  };

  const seen = new Set<number>();
  for (const offset of pastedMap.map) {
    if (seen.has(offset)) continue;
    seen.add(offset);
    const rect = pastedMap.findCell(offset);
    const src = pastedNode.nodeAt(offset)!;
    const row = region.top + rect.top;
    const col = region.left + rect.left;
    const rowspan = rect.bottom - rect.top;
    const colspan = rect.right - rect.left;
    const old = oldAt(row, col);
    const type = old ? old.type : rowTypeAt(row);
    const attrs = {
      ...(old?.attrs ?? {}),
      ...src.attrs,
      colspan,
      rowspan,
      colwidth: old && colspan === 1 ? (old.attrs.colwidth ?? null) : null,
      ...(old ? { id: old.attrs.id } : {}),
    };
    if (old === null && "id" in attrs) attrs.id = null;
    place({
      node: type.create(attrs, src.content, src.marks),
      row,
      col,
      rowspan,
      colspan,
    });
  }

  // Rebuild rows. Appended / uncovered slots get empty cells (header type in a header row).
  const rows: ProseMirrorNode[] = [];
  for (let r = 0; r < plan.rowCount; r++) {
    const rowCells: ProseMirrorNode[] = [];
    for (let c = 0; c < plan.colCount; c++) {
      let slot = owner[r]![c];
      if (!slot) {
        const colType = r < map.height ? rowTypeAt(r) : cellType;
        const node = emptyCell(state, colType);
        slot = { node, row: r, col: c, rowspan: 1, colspan: 1 };
        place(slot);
      }
      if (slot.row === r && slot.col === c) rowCells.push(slot.node);
    }
    const oldRow = r < map.height ? table.child(r) : null;
    const rowType = oldRow ? oldRow.type : schema.nodes[TABLE_NODE_NAMES.row]!;
    rows.push(rowType.create(oldRow?.attrs, rowCells));
  }

  const newTable = withBlockIds(table.type.create(table.attrs, rows, table.marks));
  const tr = state.tr.replaceWith(tablePos, tablePos + table.nodeSize, newTable);

  // Select the pasted region, ready for follow-up edits.
  const newMap = TableMap.get(newTable);
  const start = tablePos + 1;
  const topLeft = start + newMap.map[region.top * newMap.width + region.left]!;
  const bottomRight = start + newMap.map[(region.bottom - 1) * newMap.width + (region.right - 1)]!;
  try {
    tr.setSelection(CellSelection.create(tr.doc, topLeft, bottomRight));
  } catch {
    // keep the mapped selection
  }
  return tr.setMeta(SKIP_UNIQUE_ID_META, true).scrollIntoView();
}

/** Replaces the selection with a new table built from `pasted`. `null` when not allowed here. */
export function pasteAsNewTable(state: EditorState, pasted: PastedTable): Transaction | null {
  const node = pastedTableToNode(pasted, state.schema, {
    mapBackground: nearestCellBackgroundColor,
  });
  if (!node) return null;
  try {
    const tr = state.tr.replaceSelectionWith(withBlockIds(node));
    // Keep a paragraph after a table that ends the document, so the cursor can leave it.
    const end = tr.doc.lastChild;
    if (isTable(end)) {
      tr.insert(tr.doc.content.size, state.schema.nodes.paragraph!.create());
    }
    return tr.setMeta(SKIP_UNIQUE_ID_META, true).scrollIntoView();
  } catch {
    return null;
  }
}

function handlePaste(view: EditorView, event: ClipboardEvent, options: TablePasteOptions): boolean {
  const data = event.clipboardData;
  if (!data || !view.editable) return false;
  const html = data.getData("text/html");
  // Copies from inside the editor are ProseMirror slices — its own paste (and the cell paste
  // of prosemirror-tables) handles them.
  if (html.includes("data-pm-slice")) return false;
  const { $from } = view.state.selection;
  if ($from.parent.type.spec.code) return false;

  const pasted = parseClipboardTable(
    { html, text: data.getData("text/plain") },
    { parseHtml: options.parseHtml },
  );
  if (!pasted) return false;

  if (pasted.rowCount === 1 && pasted.colCount === 1) {
    // One spreadsheet cell: paste its text, not a 1×1 table.
    const text = pasted.rows[0]?.[0]?.text ?? "";
    if (!text) return false;
    view.pasteText(text, event);
    return true;
  }

  const inTable = tableAround(view.state) !== null;
  const tr = inTable ? pasteIntoTable(view.state, pasted) : pasteAsNewTable(view.state, pasted);
  if (!tr) return false;
  view.dispatch(tr.setMeta("paste", true).setMeta("uiEvent", "paste"));
  return true;
}

export const TablePaste = Extension.create<TablePasteOptions>({
  name: "tablePaste",

  addOptions() {
    return { parseHtml: undefined };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        key: tablePastePluginKey,
        props: {
          handlePaste: (view, event) => handlePaste(view, event, options),
        },
      }),
    ];
  },
});
