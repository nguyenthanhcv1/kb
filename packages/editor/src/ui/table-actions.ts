import { type Editor, Extension, findParentNode } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { type EditorState, Selection } from "@tiptap/pm/state";
import { selectedRect, TableMap } from "@tiptap/pm/tables";

import { TABLE_NODE_NAMES } from "../extensions/table";
import { csvFileName, tableNodeToCsv } from "../table/csv";

/** The table holding the selection: the node, its position (before it) and its content start. */
export interface TableAt {
  node: ProseMirrorNode;
  pos: number;
  start: number;
}

/** Innermost table around the selection (a cell selection counts), or `null`. */
export function findTable(state: EditorState): TableAt | null {
  const found = findParentNode((node) => node.type.name === TABLE_NODE_NAMES.table)(
    state.selection,
  );
  return found ? { node: found.node, pos: found.pos, start: found.start } : null;
}

/** `true` when every cell of the first row is a header cell. */
export function hasHeaderRow(table: ProseMirrorNode): boolean {
  const first = table.firstChild;
  if (!first || first.childCount === 0) return false;
  let all = true;
  first.forEach((cell) => {
    if (cell.type.name !== TABLE_NODE_NAMES.header) all = false;
  });
  return all;
}

/** `true` when every cell of the first column is a header cell (merged cells count once). */
export function hasHeaderColumn(table: ProseMirrorNode): boolean {
  const map = TableMap.get(table);
  if (map.height === 0) return false;
  for (let row = 0; row < map.height; row++) {
    const cell = table.nodeAt(map.map[row * map.width]!);
    if (cell?.type.name !== TABLE_NODE_NAMES.header) return false;
  }
  return true;
}

/**
 * Whether the selected cells span every row (or column). prosemirror-tables refuses to delete
 * them only when dispatching, so `can()` alone would enable "Delete row" in a one-row table.
 */
function selectionCoversAll(state: EditorState, axis: "rows" | "columns"): boolean {
  if (!findTable(state)) return false;
  const rect = selectedRect(state);
  return axis === "rows"
    ? rect.top === 0 && rect.bottom === rect.map.height
    : rect.left === 0 && rect.right === rect.map.width;
}

export const TABLE_ACTION_GROUPS = ["rows", "columns", "header", "table"] as const;
export type TableActionGroup = (typeof TABLE_ACTION_GROUPS)[number];

export type TableActionId =
  | "addRowBefore"
  | "addRowAfter"
  | "deleteRow"
  | "addColumnBefore"
  | "addColumnAfter"
  | "deleteColumn"
  | "toggleHeaderRow"
  | "toggleHeaderColumn"
  | "deleteTable";

export interface TableAction {
  /** Stable code; the UI maps it to a label (`table.actions.<id>`) and an icon. */
  id: TableActionId;
  group: TableActionGroup;
  /** Header toggles: the UI shows them as checkboxes (see `TableMenuState.checked`). */
  toggle?: "headerRow" | "headerColumn";
  /** Runs the action on the table holding the selection and gives focus back to the editor. */
  run: (editor: Editor) => boolean;
  /** Whether `run` would do something for the current selection. */
  can: (editor: Editor) => boolean;
}

/**
 * Every editing action of the table menu (docs/PLAN.md T4.1), in menu order. CSV export is not
 * listed: it downloads a file instead of changing the document (see `tableCsvExport`).
 */
export const TABLE_ACTIONS: readonly TableAction[] = [
  {
    id: "addRowBefore",
    group: "rows",
    run: (e) => e.chain().focus().addRowBefore().run(),
    can: (e) => e.can().addRowBefore(),
  },
  {
    id: "addRowAfter",
    group: "rows",
    run: (e) => addRowBelow(e),
    can: (e) => e.can().addRowAfter(),
  },
  {
    id: "deleteRow",
    group: "rows",
    run: (e) => e.chain().focus().deleteRow().run(),
    can: (e) => e.can().deleteRow() && !selectionCoversAll(e.state, "rows"),
  },
  {
    id: "addColumnBefore",
    group: "columns",
    run: (e) => e.chain().focus().addColumnBefore().run(),
    can: (e) => e.can().addColumnBefore(),
  },
  {
    id: "addColumnAfter",
    group: "columns",
    run: (e) => e.chain().focus().addColumnAfter().run(),
    can: (e) => e.can().addColumnAfter(),
  },
  {
    id: "deleteColumn",
    group: "columns",
    run: (e) => e.chain().focus().deleteColumn().run(),
    can: (e) => e.can().deleteColumn() && !selectionCoversAll(e.state, "columns"),
  },
  {
    id: "toggleHeaderRow",
    group: "header",
    toggle: "headerRow",
    run: (e) => e.chain().focus().toggleHeaderRow().run(),
    can: (e) => e.can().toggleHeaderRow(),
  },
  {
    id: "toggleHeaderColumn",
    group: "header",
    toggle: "headerColumn",
    run: (e) => e.chain().focus().toggleHeaderColumn().run(),
    can: (e) => e.can().toggleHeaderColumn(),
  },
  {
    id: "deleteTable",
    group: "table",
    run: (e) => e.chain().focus().deleteTable().run(),
    can: (e) => e.can().deleteTable(),
  },
];

export interface TableMenuState {
  /** Selection is inside a table (the menu is shown only then). */
  inTable: boolean;
  /** Per action id: enabled for the current selection. */
  enabled: Record<TableActionId, boolean>;
  checked: { headerRow: boolean; headerColumn: boolean };
}

/** Snapshot for the table toolbar (cheap enough to compute on every transaction). */
export function getTableMenuState(editor: Editor): TableMenuState {
  const table = findTable(editor.state);
  const editable = editor.isEditable;
  return {
    inTable: table !== null,
    enabled: Object.fromEntries(
      TABLE_ACTIONS.map((action) => [action.id, Boolean(table && editable && action.can(editor))]),
    ) as Record<TableActionId, boolean>,
    checked: {
      headerRow: table ? hasHeaderRow(table.node) : false,
      headerColumn: table ? hasHeaderColumn(table.node) : false,
    },
  };
}

/**
 * Adds a row below the selected cell and moves the caret into the new row, same column
 * (Mod-Enter, "Insert row below").
 */
export function addRowBelow(editor: Editor): boolean {
  const table = findTable(editor.state);
  if (!table || !editor.can().addRowAfter()) return false;
  const { $from } = editor.state.selection;
  let cellPos: number | null = null;
  for (let depth = $from.depth; depth > 0; depth--) {
    const role = $from.node(depth).type.spec.tableRole as string | undefined;
    if (role === "cell" || role === "header_cell") {
      cellPos = $from.before(depth);
      break;
    }
  }
  const rect = cellPos === null ? null : TableMap.get(table.node).findCell(cellPos - table.start);

  if (!editor.chain().focus().addRowAfter().run()) return false;
  if (!rect) return true;

  const updated = editor.state.doc.nodeAt(table.pos);
  if (!updated) return true;
  const map = TableMap.get(updated);
  const row = Math.min(rect.bottom, map.height - 1);
  const target = table.start + map.positionAt(row, rect.left, updated);
  const selection = Selection.near(editor.state.doc.resolve(target + 1));
  editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
  return true;
}

/**
 * CSV text and download name of the table holding the selection (T4.5 `csv.ts`: RFC 4180,
 * UTF-8 BOM so Excel shows Vietnamese, merged cells once), or `null` outside a table.
 */
export function tableCsvExport(
  state: EditorState,
  pageTitle: string | undefined,
  date: Date = new Date(),
): { csv: string; fileName: string } | null {
  const table = findTable(state);
  if (!table) return null;
  return { csv: tableNodeToCsv(table.node), fileName: csvFileName(pageTitle, date) };
}

export interface TableShortcutsOptions {
  /** Alt-F10 inside a table: move keyboard focus to the table toolbar. */
  onMenuShortcut: (editor: Editor) => boolean;
}

/**
 * Table keys on top of the extension's own Tab / Shift-Tab (next/previous cell, Tab in the last
 * cell appends a row): Mod-Enter inserts a row below, Alt-F10 opens the table toolbar (the usual
 * "focus the toolbar" key of rich-text editors).
 */
export const TableShortcuts = Extension.create<TableShortcutsOptions>({
  name: "tableShortcuts",

  addOptions() {
    return { onMenuShortcut: () => false };
  },

  addKeyboardShortcuts() {
    const inTable = () => findTable(this.editor.state) !== null;
    return {
      "Mod-Enter": () => inTable() && addRowBelow(this.editor),
      "Alt-F10": () => inTable() && this.options.onMenuShortcut(this.editor),
    };
  },
});
