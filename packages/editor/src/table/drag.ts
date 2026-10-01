import { type Editor, Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey, Selection, type Transaction } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/**
 * Drag-and-drop of table rows and columns (T4.3) — written for this project, TipTap has no
 * equivalent outside its paid extensions.
 *
 * Two layers:
 * - pure functions on the document (`getMovableSpan`, `getDropTargets`, `moveTableLine`) that
 *   decide what can move and build the transaction. The merged-cell rule lives here;
 * - a ProseMirror plugin (`TableDrag`) with a handle at the edge of every row / column, the
 *   drop-position preview and keyboard moves.
 *
 * Merged cells: a row/column that is part of a merged cell cannot be pulled out of it, so the
 * dragged unit grows to the smallest block of rows/columns no merged cell crosses ("move the
 * whole block"), and a drop position inside a merged cell is refused. Cells keep all their
 * attributes (block ID, colour, width), so nothing but the order changes.
 */

export type TableAxis = "row" | "column";

/** A run of rows/columns `[start, end)`. */
export interface LineSpan {
  start: number;
  end: number;
}

function isTable(node: ProseMirrorNode | null | undefined): node is ProseMirrorNode {
  return node?.type.spec.tableRole === "table";
}

function lineCount(map: TableMap, axis: TableAxis): number {
  return axis === "row" ? map.height : map.width;
}

/** `ok[b]`: boundary `b` (before line `b`, 0..count) is crossed by no merged cell. */
function cuttableBoundaries(map: TableMap, axis: TableAxis): boolean[] {
  const ok: boolean[] = Array.from({ length: lineCount(map, axis) + 1 }, () => true);
  const seen = new Set<number>();
  for (const pos of map.map) {
    if (seen.has(pos)) continue;
    seen.add(pos);
    const rect = map.findCell(pos);
    const lo = axis === "row" ? rect.top : rect.left;
    const hi = axis === "row" ? rect.bottom : rect.right;
    for (let b = lo + 1; b < hi; b++) ok[b] = false;
  }
  return ok;
}

/**
 * The rows/columns that move together when line `index` is dragged: just that line, or the
 * smallest block around it that no merged cell crosses. `null` for an index outside the table.
 */
export function getMovableSpan(
  table: ProseMirrorNode,
  axis: TableAxis,
  index: number,
): LineSpan | null {
  if (!isTable(table)) return null;
  const map = TableMap.get(table);
  if (index < 0 || index >= lineCount(map, axis)) return null;
  const ok = cuttableBoundaries(map, axis);
  let start = index;
  let end = index + 1;
  while (!ok[start]) start--;
  while (!ok[end]) end++;
  return { start, end };
}

/**
 * Boundaries (0..count, "before line b") where the block of line `index` can be dropped:
 * not inside a merged cell and not where it already is.
 */
export function getDropTargets(table: ProseMirrorNode, axis: TableAxis, index: number): number[] {
  const span = getMovableSpan(table, axis, index);
  if (!span) return [];
  const ok = cuttableBoundaries(TableMap.get(table), axis);
  const targets: number[] = [];
  ok.forEach((cuttable, b) => {
    if (cuttable && (b < span.start || b > span.end)) targets.push(b);
  });
  return targets;
}

/**
 * Moves the row/column `index` (with its merged block, see `getMovableSpan`) in front of
 * boundary `dest` of the table at `tablePos`, as ONE transaction (one undo step). The rows /
 * cells are moved by deleting and re-inserting them, never by rewriting the table, so edits
 * other collaborators make in the rest of the table at the same time still apply. `null` when
 * the move is refused (not a table, bad index, drop inside a merged cell, or a no-op).
 */
export function moveTableLine(
  state: EditorState,
  tablePos: number,
  axis: TableAxis,
  index: number,
  dest: number,
): Transaction | null {
  const table = state.doc.nodeAt(tablePos);
  if (!isTable(table)) return null;
  const span = getMovableSpan(table, axis, index);
  if (!span || !getDropTargets(table, axis, index).includes(dest)) return null;
  const map = TableMap.get(table);
  const tableStart = tablePos + 1;
  const tr = state.tr;

  if (axis === "row") {
    const offsets: number[] = [];
    table.forEach((_row, offset) => offsets.push(offset));
    offsets.push(table.content.size);
    const from = tableStart + offsets[span.start]!;
    const to = tableStart + offsets[span.end]!;
    const destPos = tableStart + offsets[dest]!;
    tr.insert(destPos, state.doc.slice(from, to).content);
    tr.delete(tr.mapping.map(from), tr.mapping.map(to));
  } else {
    // Bottom-up: editing a row only shifts the rows below it, which are already done.
    const rows: { node: ProseMirrorNode; offset: number }[] = [];
    table.forEach((node, offset) => rows.push({ node, offset }));
    for (let r = rows.length - 1; r >= 0; r--) {
      const { node: row, offset: rowOffset } = rows[r]!;
      const cells: { pos: number; end: number; left: number }[] = [];
      row.forEach((cell, cellOffset) => {
        const pos = tableStart + rowOffset + 1 + cellOffset;
        cells.push({
          pos,
          end: pos + cell.nodeSize,
          left: map.findCell(rowOffset + 1 + cellOffset).left,
        });
      });
      const moving = cells.filter((c) => c.left >= span.start && c.left < span.end);
      if (moving.length === 0) continue;
      const from = moving[0]!.pos;
      const to = moving[moving.length - 1]!.end;
      const before = cells.find((c) => c.left >= dest);
      const destPos = before ? before.pos : tableStart + rowOffset + row.nodeSize - 1;
      if (destPos === from || destPos === to) continue;
      tr.insert(destPos, state.doc.slice(from, to).content);
      tr.delete(tr.mapping.map(from), tr.mapping.map(to));
    }
  }
  if (!tr.docChanged) return null;

  // Put the caret in the moved line (a cell selection would not map across the move).
  const count = span.end - span.start;
  const moved = dest < span.start ? dest : dest - count;
  const next = tr.doc.nodeAt(tablePos);
  if (isTable(next)) {
    const nextMap = TableMap.get(next);
    const cellOffset = axis === "row" ? nextMap.map[moved * nextMap.width] : nextMap.map[moved];
    if (cellOffset !== undefined) {
      tr.setSelection(Selection.near(tr.doc.resolve(tableStart + cellOffset + 1)));
    }
  }
  return tr.scrollIntoView();
}

/** Where the line `index` ends up when moved one step (`-1` up/left, `1` down/right), or null. */
export function neighbourBoundary(
  table: ProseMirrorNode,
  axis: TableAxis,
  index: number,
  step: -1 | 1,
): number | null {
  const span = getMovableSpan(table, axis, index);
  if (!span) return null;
  const targets = getDropTargets(table, axis, index);
  if (step < 0) {
    const before = targets.filter((b) => b < span.start);
    return before.length ? Math.max(...before) : null;
  }
  const after = targets.filter((b) => b > span.end);
  return after.length ? Math.min(...after) : null;
}

/** Moves the row/column holding the caret one step; used by the keyboard shortcuts. */
export function moveCurrentLine(editor: Editor, axis: TableAxis, step: -1 | 1): boolean {
  if (!editor.isEditable) return false;
  const { $from } = editor.state.selection;
  let tablePos = -1;
  let cellPos = -1;
  for (let depth = $from.depth; depth > 0; depth--) {
    const role = $from.node(depth).type.spec.tableRole as string | undefined;
    if (role === "cell" || role === "header_cell") cellPos = $from.before(depth);
    if (role === "table") {
      tablePos = $from.before(depth);
      break;
    }
  }
  if (tablePos < 0 || cellPos < 0) return false;
  const table = editor.state.doc.nodeAt(tablePos)!;
  const rect = TableMap.get(table).findCell(cellPos - tablePos - 1);
  const index = axis === "row" ? rect.top : rect.left;
  const dest = neighbourBoundary(table, axis, index, step);
  if (dest === null) return false;
  const tr = moveTableLine(editor.state, tablePos, axis, index, dest);
  if (!tr) return false;
  editor.view.dispatch(tr);
  return true;
}

// --- plugin -----------------------------------------------------------------------------

interface DragState {
  axis: TableAxis;
  tablePos: number;
  index: number;
  span: LineSpan;
  /** Boundary under the pointer, or `null` when there is no valid drop position there. */
  over: number | null;
}

type DragMeta =
  | { type: "start"; axis: TableAxis; tablePos: number; index: number }
  | { type: "over"; over: number | null }
  | { type: "end" };

export const tableDragPluginKey = new PluginKey<DragState | null>("tableDrag");

export interface TableDragOptions {
  /** Accessible names of the handles (already translated). */
  labels: { row: string; column: string };
}

/** Class names used by the plugin; the stylesheet lives in `apps/web` (`editor.css`). */
export const TABLE_DRAG_CLASSES = {
  handle: "kb-table-handle",
  rowHandle: "kb-table-handle-row",
  columnHandle: "kb-table-handle-column",
  dragging: "kb-table-dragging",
  source: "kb-drag-source",
  dropBefore: "kb-drop-before",
  dropAfter: "kb-drop-after",
} as const;

function createHandle(axis: TableAxis, tablePos: number, index: number, label: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.tabIndex = -1;
  button.contentEditable = "false";
  button.draggable = false;
  button.setAttribute("aria-label", label);
  button.dataset.axis = axis;
  button.dataset.index = String(index);
  button.dataset.tablePos = String(tablePos);
  button.className = `${TABLE_DRAG_CLASSES.handle} ${
    axis === "row" ? TABLE_DRAG_CLASSES.rowHandle : TABLE_DRAG_CLASSES.columnHandle
  }`;
  button.innerHTML =
    '<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true" focusable="false">' +
    '<circle cx="3" cy="3" r="1.2"/><circle cx="7" cy="3" r="1.2"/>' +
    '<circle cx="3" cy="8" r="1.2"/><circle cx="7" cy="8" r="1.2"/>' +
    '<circle cx="3" cy="13" r="1.2"/><circle cx="7" cy="13" r="1.2"/></svg>';
  return button;
}

function buildDecorations(
  state: EditorState,
  drag: DragState | null | undefined,
  labels: TableDragOptions["labels"],
): DecorationSet {
  const decorations: Decoration[] = [];
  state.doc.descendants((table, tablePos) => {
    if (!isTable(table)) return true;
    const map = TableMap.get(table);
    const tableStart = tablePos + 1;
    const active = drag && drag.tablePos === tablePos ? drag : null;

    // Handles: rows on the first cell of every row, columns on the cells of the first row.
    let rowIndex = 0;
    table.forEach((row, rowOffset) => {
      const index = rowIndex++;
      if (row.childCount === 0) return;
      decorations.push(
        Decoration.widget(
          tableStart + rowOffset + 2,
          () => createHandle("row", tablePos, index, labels.row),
          { side: -1, key: `row-${tablePos}-${index}-${labels.row}`, ignoreSelection: true },
        ),
      );
    });
    const firstRow = table.firstChild;
    if (firstRow) {
      firstRow.forEach((_cell, cellOffset) => {
        const left = map.findCell(1 + cellOffset).left;
        decorations.push(
          Decoration.widget(
            tableStart + 1 + cellOffset + 1,
            () => createHandle("column", tablePos, left, labels.column),
            { side: -1, key: `column-${tablePos}-${left}-${labels.column}`, ignoreSelection: true },
          ),
        );
      });
    }

    if (active) {
      decorations.push(
        Decoration.node(tablePos, tablePos + table.nodeSize, {
          class: TABLE_DRAG_CLASSES.dragging,
        }),
      );
      const seen = new Set<number>();
      for (const offset of map.map) {
        if (seen.has(offset)) continue;
        seen.add(offset);
        const rect = map.findCell(offset);
        const lo = active.axis === "row" ? rect.top : rect.left;
        const hi = active.axis === "row" ? rect.bottom : rect.right;
        const classes: string[] = [];
        if (lo >= active.span.start && hi <= active.span.end)
          classes.push(TABLE_DRAG_CLASSES.source);
        if (active.over !== null) {
          const count = lineCount(map, active.axis);
          if (lo === active.over) classes.push(TABLE_DRAG_CLASSES.dropBefore);
          else if (active.over === count && hi === count)
            classes.push(TABLE_DRAG_CLASSES.dropAfter);
        }
        if (classes.length === 0) continue;
        const pos = tableStart + offset;
        const cell = state.doc.nodeAt(pos);
        if (!cell) continue;
        decorations.push(
          Decoration.node(pos, pos + cell.nodeSize, {
            class: `${classes.join(" ")} kb-drag-${active.axis}`,
          }),
        );
      }
    }
    return false;
  });
  return DecorationSet.create(state.doc, decorations);
}

/** Boundary under the pointer for the dragged line, snapped to the nearest valid one. */
function boundaryAtPointer(
  view: EditorView,
  drag: DragState,
  clientX: number,
  clientY: number,
): number | null {
  const table = view.state.doc.nodeAt(drag.tablePos);
  if (!isTable(table)) return null;
  const targets = getDropTargets(table, drag.axis, drag.index);
  if (targets.length === 0) return null;
  const map = TableMap.get(table);
  const tableStart = drag.tablePos + 1;

  // Screen position of every boundary: the edge of the first cell starting there.
  const edge = (b: number): number | null => {
    const count = lineCount(map, drag.axis);
    const line = Math.min(b, count - 1);
    const cellOffset = drag.axis === "row" ? map.map[line * map.width] : map.map[line];
    if (cellOffset === undefined) return null;
    const dom = view.nodeDOM(tableStart + cellOffset);
    if (!(dom instanceof HTMLElement)) return null;
    const rect = dom.getBoundingClientRect();
    if (drag.axis === "row") return b === count ? rect.bottom : rect.top;
    return b === count ? rect.right : rect.left;
  };

  const pointer = drag.axis === "row" ? clientY : clientX;
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const b of targets) {
    const position = edge(b);
    if (position === null) continue;
    const distance = Math.abs(position - pointer);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = b;
    }
  }
  return best;
}

function startDrag(view: EditorView, handle: HTMLElement, event: PointerEvent) {
  const axis = handle.dataset.axis === "row" ? "row" : "column";
  const tablePos = Number(handle.dataset.tablePos);
  const index = Number(handle.dataset.index);
  // The widget key contains the table position, so a stale handle is re-created on any shift.
  const livePos = tablePos;
  const table = view.state.doc.nodeAt(livePos);
  if (!isTable(table) || !getMovableSpan(table, axis, index)) return;

  event.preventDefault();
  view.dispatch(
    view.state.tr.setMeta(tableDragPluginKey, {
      type: "start",
      axis,
      tablePos: livePos,
      index,
    } satisfies DragMeta),
  );

  const doc = handle.ownerDocument;
  const cleanup = () => {
    doc.removeEventListener("pointermove", onMove);
    doc.removeEventListener("pointerup", onUp);
    doc.removeEventListener("pointercancel", onCancel);
    doc.removeEventListener("keydown", onKey, true);
  };
  const current = () => tableDragPluginKey.getState(view.state) ?? null;
  const onMove = (e: PointerEvent) => {
    const drag = current();
    if (!drag) return cleanup();
    const over = boundaryAtPointer(view, drag, e.clientX, e.clientY);
    if (over !== drag.over) {
      view.dispatch(
        view.state.tr.setMeta(tableDragPluginKey, { type: "over", over } satisfies DragMeta),
      );
    }
  };
  const finish = (apply: boolean) => {
    cleanup();
    const drag = current();
    if (!drag) return;
    const tr =
      apply && drag.over !== null
        ? moveTableLine(view.state, drag.tablePos, drag.axis, drag.index, drag.over)
        : null;
    // The end marker and the move are one transaction: a single undo step, no stray state.
    const end = (tr ?? view.state.tr).setMeta(tableDragPluginKey, {
      type: "end",
    } satisfies DragMeta);
    view.dispatch(end);
    view.focus();
  };
  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    finish(false);
  };
  doc.addEventListener("pointermove", onMove);
  doc.addEventListener("pointerup", onUp);
  doc.addEventListener("pointercancel", onCancel);
  doc.addEventListener("keydown", onKey, true);
  onMove(event);
}

/**
 * Row/column drag handles for tables (T4.3). Handles are `button`s rendered inside the first
 * cell of each row and the cells of the first row; the stylesheet decides when they show.
 * Only editable views get handles. Keyboard: Mod-Alt-Shift-Arrow moves the row/column of the
 * caret one step.
 */
export const TableDrag = Extension.create<TableDragOptions>({
  name: "tableDrag",

  addOptions() {
    return { labels: { row: "Drag row", column: "Drag column" } };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Alt-Shift-ArrowUp": () => moveCurrentLine(this.editor, "row", -1),
      "Mod-Alt-Shift-ArrowDown": () => moveCurrentLine(this.editor, "row", 1),
      "Mod-Alt-Shift-ArrowLeft": () => moveCurrentLine(this.editor, "column", -1),
      "Mod-Alt-Shift-ArrowRight": () => moveCurrentLine(this.editor, "column", 1),
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const labels = this.options.labels;
    return [
      new Plugin<DragState | null>({
        key: tableDragPluginKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(tableDragPluginKey) as DragMeta | undefined;
            if (meta?.type === "end") return null;
            if (meta?.type === "start") {
              const table = tr.doc.nodeAt(meta.tablePos);
              const span = isTable(table) ? getMovableSpan(table, meta.axis, meta.index) : null;
              return span
                ? { axis: meta.axis, tablePos: meta.tablePos, index: meta.index, span, over: null }
                : null;
            }
            if (!value) return null;
            let next = value;
            if (tr.docChanged) {
              // A remote edit moved or removed the table: follow it, or drop the drag.
              const tablePos = tr.mapping.map(value.tablePos);
              const table = tr.doc.nodeAt(tablePos);
              const span = isTable(table) ? getMovableSpan(table, value.axis, value.index) : null;
              if (!span) return null;
              next = { ...value, tablePos, span };
            }
            if (meta?.type === "over") next = { ...next, over: meta.over };
            return next;
          },
        },
        props: {
          decorations(state) {
            if (!editor.isEditable) return null;
            return buildDecorations(state, tableDragPluginKey.getState(state), labels);
          },
          handleDOMEvents: {
            pointerdown(view, event) {
              if (!editor.isEditable || event.button !== 0) return false;
              const target = event.target;
              if (!(target instanceof Element)) return false;
              const handle = target.closest<HTMLElement>(`.${TABLE_DRAG_CLASSES.handle}`);
              if (!handle) return false;
              startDrag(view, handle, event);
              return true;
            },
            // The handle is not content: stop ProseMirror from moving the selection onto it.
            mousedown(_view, event) {
              const target = event.target;
              return (
                target instanceof Element &&
                target.closest(`.${TABLE_DRAG_CLASSES.handle}`) !== null
              );
            },
          },
        },
      }),
    ];
  },
});
