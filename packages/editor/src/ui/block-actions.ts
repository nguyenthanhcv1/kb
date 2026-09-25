import type { Editor, JSONContent } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";

/** Nested blocks that move on their own (a list item moves inside its list). */
const MOVABLE_CONTAINERS = new Set(["listItem", "taskItem"]);

export type MoveDirection = "up" | "down";

/**
 * Position (before the node) of the block the cursor is in: the innermost list item, otherwise
 * the top-level block. `null` when the selection is not inside any block.
 */
export function currentBlockPos(state: EditorState): number | null {
  const { $from } = state.selection;
  if (state.selection instanceof NodeSelection) return state.selection.from;
  for (let depth = $from.depth; depth > 0; depth--) {
    if (depth === 1 || MOVABLE_CONTAINERS.has($from.node(depth).type.name)) {
      return $from.before(depth);
    }
  }
  return null;
}

/**
 * Swaps the block at `pos` with its previous/next sibling, keeping the selection inside the
 * moved block. Keyboard alternative to the drag handle. Returns `false` at the edge.
 */
export function moveBlock(editor: Editor, pos: number, direction: MoveDirection): boolean {
  const { state } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return false;
  const $pos = state.doc.resolve(pos);
  const index = $pos.index();
  const sibling =
    direction === "up" ? $pos.parent.maybeChild(index - 1) : $pos.parent.maybeChild(index + 1);
  if (!sibling) return false;

  const end = pos + node.nodeSize;
  const target = direction === "up" ? pos - sibling.nodeSize : pos + sibling.nodeSize;
  const { selection } = state;
  const inside = selection.from >= pos && selection.to <= end;

  const tr = state.tr.delete(pos, end).insert(target, node);
  if (selection instanceof NodeSelection && selection.from === pos) {
    tr.setSelection(NodeSelection.create(tr.doc, target));
  } else if (inside) {
    const shift = target - pos;
    tr.setSelection(TextSelection.create(tr.doc, selection.from + shift, selection.to + shift));
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

function withoutIds(json: JSONContent): JSONContent {
  const attrs = json.attrs ? { ...json.attrs, id: null } : undefined;
  return { ...json, ...(attrs && { attrs }), content: json.content?.map(withoutIds) };
}

/** Inserts a copy of the block at `pos` right after it. The copy gets fresh block IDs. */
export function duplicateBlock(editor: Editor, pos: number): boolean {
  const { state } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return false;
  const copy = state.schema.nodeFromJSON(withoutIds(node.toJSON() as JSONContent));
  const after = pos + node.nodeSize;
  const tr = state.tr.insert(after, copy);
  tr.setSelection(Selection.near(tr.doc.resolve(after + 1)));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Deletes the block at `pos` (the document keeps at least one empty paragraph). */
export function deleteBlock(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  return editor
    .chain()
    .focus()
    .deleteRange({ from: pos, to: pos + node.nodeSize })
    .run();
}
