import { type AnyExtension, getSchema } from "@tiptap/core";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import type { UniqueIDOptions } from "@tiptap/extension-unique-id";
import type { Schema } from "@tiptap/pm/model";
import { StarterKit } from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";

import { Callout } from "./callout";
import { QuietTrailingNode, QuietUniqueID } from "./quiet-open";
import { createTableExtensions } from "./table";

export { CALLOUT_VARIANTS, Callout, type CalloutVariant } from "./callout";
export { isRemoteTransaction } from "./quiet-open";
export {
  CELL_BACKGROUND_ATTR,
  CELL_BACKGROUND_COLORS,
  CELL_BACKGROUND_DATA_ATTR,
  type CellBackgroundColor,
  createTableExtensions,
  DEFAULT_TABLE_SIZE,
  isCellBackgroundColor,
  nearestCellBackgroundColor,
  TABLE_CELL_MIN_WIDTH,
  TABLE_NODE_NAMES,
} from "./table";

/**
 * Transaction meta that makes UniqueID skip a transaction. For bulk inserts that create every
 * node with its own ID already (table paste, T4.4b): UniqueID's duplicate check is quadratic
 * in the number of new blocks and takes seconds for a few thousand table cells.
 */
export const SKIP_UNIQUE_ID_META = "kbSkipUniqueId";

export const HEADING_LEVELS = [1, 2, 3] as const;

/**
 * Node types that carry a stable block ID (`attrs.id`, rendered as `data-id`).
 * Used for deep links, comments (V2) and RAG citations (V3). New block nodes
 * must be added here — and `EDITOR_SCHEMA_VERSION` bumped.
 */
export const BLOCK_ID_TYPES = [
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "codeBlock",
  "horizontalRule",
  "image",
  "callout",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
] as const;

export interface CreateExtensionsOptions {
  /**
   * Keep ProseMirror's own undo/redo. Turn it off when the document is bound to
   * Yjs: the Collaboration extension provides its own undo manager.
   * @default true
   */
  undoRedo?: boolean;
  /**
   * Runtime behaviour of block ID assignment, e.g. `filterTransaction` to skip
   * transactions coming from other collaborators, or `updateDocument: false`
   * for read-only views. Never changes the schema.
   */
  uniqueId?: Partial<Pick<UniqueIDOptions, "filterTransaction" | "updateDocument">>;
}

const lowlight = createLowlight(common);

/**
 * The one TipTap extension set shared by the web editor, `kb-collab` and the
 * search/RAG extractors. Options only toggle runtime behaviour; the resulting
 * schema is always identical (see `getEditorSchema`).
 *
 * Safe to import in Node: nothing here touches the DOM until an editor view is
 * mounted.
 */
export function createExtensions(options: CreateExtensionsOptions = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [...HEADING_LEVELS] },
      link: {
        autolink: true,
        defaultProtocol: "https",
        openOnClick: false,
      },
      undoRedo: options.undoRedo === false ? false : {},
      // Replaced by QuietTrailingNode: opening a page must not change it (quiet-open.ts).
      trailingNode: false,
    }),
    QuietTrailingNode,
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({ inline: false, allowBase64: false }),
    Callout,
    ...createTableExtensions(),
    QuietUniqueID.configure({
      types: [...BLOCK_ID_TYPES],
      ...options.uniqueId,
      filterTransaction: (tr) =>
        !tr.getMeta(SKIP_UNIQUE_ID_META) && (options.uniqueId?.filterTransaction?.(tr) ?? true),
    }),
  ];
}

/** ProseMirror schema of the shared extension set, e.g. for server-side parsing. */
export function getEditorSchema(): Schema {
  return getSchema(createExtensions());
}
