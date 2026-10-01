/**
 * Framework-agnostic pieces of the editor UI (T3.2): slash menu items and extension, block
 * actions used by the drag handle menu, and keyboard shortcuts. Rendering lives in
 * `apps/web/src/components/editor`. Kept out of the root export so `kb-collab` and the
 * extractors never load UI code.
 */
export {
  currentBlockPos,
  deleteBlock,
  duplicateBlock,
  moveBlock,
  type MoveDirection,
} from "./block-actions";
export {
  EDITOR_SHORTCUTS,
  type EditorShortcut,
  EditorShortcuts,
  type EditorShortcutsOptions,
  formatShortcutKeys,
  SHORTCUT_GROUPS,
} from "./shortcuts";
export {
  runSlashItem,
  SlashCommand,
  type SlashCommandOptions,
  slashCommandPluginKey,
  type SlashSelectProps,
} from "./slash-command";
export {
  filterSlashItems,
  SLASH_GROUPS,
  SLASH_ITEMS,
  type SlashGroup,
  type SlashItem,
  type SlashItemInput,
} from "./slash-items";
export {
  addRowBelow,
  findTable,
  getCellBackground,
  getTableMenuState,
  hasHeaderColumn,
  hasHeaderRow,
  TABLE_ACTION_GROUPS,
  TABLE_ACTIONS,
  type TableAction,
  type TableActionGroup,
  type TableActionId,
  type TableAt,
  tableCsvExport,
  type TableMenuState,
  setCellBackground,
  splitMergedCell,
  TableShortcuts,
  type TableShortcutsOptions,
} from "./table-actions";
export {
  CELL_BACKGROUND_COLORS,
  type CellBackgroundColor,
  isCellBackgroundColor,
} from "../extensions/table";
export { CSV_MIME_TYPE } from "../table/csv";
export {
  getDropTargets,
  getMovableSpan,
  moveCurrentLine,
  moveTableLine,
  neighbourBoundary,
  TABLE_DRAG_CLASSES,
  TableDrag,
  type TableAxis,
  type TableDragOptions,
  type LineSpan,
} from "../table/drag";
export {
  pasteAsNewTable,
  pasteIntoTable,
  TablePaste,
  tablePastePluginKey,
  type TablePasteOptions,
} from "../table/paste-extension";
export { Placeholder } from "@tiptap/extensions";
export type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
export { normalizeImageSrc, normalizeLinkHref } from "./link";
