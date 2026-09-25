import { type Editor, Extension } from "@tiptap/core";

import { currentBlockPos, duplicateBlock, moveBlock } from "./block-actions";

/**
 * Keyboard shortcuts shown in the help dialog. `keys` use TipTap names (`Mod` = ⌘ on macOS,
 * Ctrl elsewhere); the UI translates `id` via `editor.shortcuts.items.<id>`.
 * Formatting/heading/list keys come from StarterKit; the rest from `EditorShortcuts`.
 */
export const EDITOR_SHORTCUTS = [
  { id: "bold", group: "format", keys: ["Mod", "B"] },
  { id: "italic", group: "format", keys: ["Mod", "I"] },
  { id: "underline", group: "format", keys: ["Mod", "U"] },
  { id: "strike", group: "format", keys: ["Mod", "Shift", "S"] },
  { id: "code", group: "format", keys: ["Mod", "E"] },
  { id: "link", group: "format", keys: ["Mod", "K"] },
  { id: "paragraph", group: "blocks", keys: ["Mod", "Alt", "0"] },
  { id: "heading1", group: "blocks", keys: ["Mod", "Alt", "1"] },
  { id: "heading2", group: "blocks", keys: ["Mod", "Alt", "2"] },
  { id: "heading3", group: "blocks", keys: ["Mod", "Alt", "3"] },
  { id: "bulletList", group: "blocks", keys: ["Mod", "Shift", "8"] },
  { id: "orderedList", group: "blocks", keys: ["Mod", "Shift", "7"] },
  { id: "taskList", group: "blocks", keys: ["Mod", "Shift", "9"] },
  { id: "blockquote", group: "blocks", keys: ["Mod", "Shift", "B"] },
  { id: "codeBlock", group: "blocks", keys: ["Mod", "Alt", "C"] },
  { id: "slash", group: "editing", keys: ["/"] },
  { id: "moveUp", group: "editing", keys: ["Mod", "Shift", "↑"] },
  { id: "moveDown", group: "editing", keys: ["Mod", "Shift", "↓"] },
  { id: "duplicate", group: "editing", keys: ["Mod", "D"] },
  { id: "undo", group: "editing", keys: ["Mod", "Z"] },
  { id: "redo", group: "editing", keys: ["Mod", "Shift", "Z"] },
  { id: "help", group: "editing", keys: ["Mod", "/"] },
] as const;

export type EditorShortcut = (typeof EDITOR_SHORTCUTS)[number];
export const SHORTCUT_GROUPS = ["format", "blocks", "editing"] as const;

/** Key caps for display: macOS symbols, or the usual PC names. */
export function formatShortcutKeys(keys: readonly string[], isMac: boolean): string[] {
  const names: Record<string, [mac: string, other: string]> = {
    Mod: ["⌘", "Ctrl"],
    Alt: ["⌥", "Alt"],
    Shift: ["⇧", "Shift"],
  };
  return keys.map((key) => names[key]?.[isMac ? 0 : 1] ?? key);
}

export interface EditorShortcutsOptions {
  /** Mod-K: open the link editor for the selection. Return `false` to let the key through. */
  onLinkShortcut: (editor: Editor) => boolean;
  /** Mod-/: open the shortcuts help. */
  onHelpShortcut: (editor: Editor) => boolean;
}

/** Block-level shortcuts not covered by StarterKit (move/duplicate) plus UI hooks. */
export const EditorShortcuts = Extension.create<EditorShortcutsOptions>({
  name: "editorShortcuts",

  addOptions() {
    return { onLinkShortcut: () => false, onHelpShortcut: () => false };
  },

  addKeyboardShortcuts() {
    const withBlock = (action: (pos: number) => boolean) => () => {
      const pos = currentBlockPos(this.editor.state);
      return pos === null ? false : action(pos);
    };
    return {
      "Mod-Shift-ArrowUp": withBlock((pos) => moveBlock(this.editor, pos, "up")),
      "Mod-Shift-ArrowDown": withBlock((pos) => moveBlock(this.editor, pos, "down")),
      "Mod-d": withBlock((pos) => duplicateBlock(this.editor, pos)),
      "Mod-k": () => this.options.onLinkShortcut(this.editor),
      "Mod-/": () => this.options.onHelpShortcut(this.editor),
    };
  },
});
