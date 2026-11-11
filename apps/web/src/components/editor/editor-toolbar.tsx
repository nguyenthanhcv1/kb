"use client";

import { type EditorShortcut, SLASH_ITEMS, type SlashItem } from "@kb/editor/ui";
import { type Editor, useEditorState } from "@tiptap/react";
import {
  BoldIcon,
  ItalicIcon,
  LinkIcon,
  type LucideIcon,
  Redo2Icon,
  Undo2Icon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/utils";

import { BLOCK_ICONS, turnInto, useBlockText } from "./block-types";
import { useShortcutLabel } from "./shortcuts-dialog";

const itemById = (id: string): SlashItem => {
  const item = SLASH_ITEMS.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Unknown slash item ${id}`);
  return item;
};

/** Block buttons, in toolbar order; `active` says whether the caret is already in that block. */
const BLOCKS: { id: string; active: (e: Editor) => boolean }[] = [
  { id: "heading1", active: (e) => e.isActive("heading", { level: 1 }) },
  { id: "heading2", active: (e) => e.isActive("heading", { level: 2 }) },
  { id: "heading3", active: (e) => e.isActive("heading", { level: 3 }) },
  { id: "bulletList", active: (e) => e.isActive("bulletList") },
  { id: "orderedList", active: (e) => e.isActive("orderedList") },
  { id: "callout.info", active: (e) => e.isActive("callout") },
  { id: "codeBlock", active: (e) => e.isActive("codeBlock") },
];

/** Keyboard shortcut of each block button (shown in its tooltip). */
const BLOCK_SHORTCUTS: Record<string, EditorShortcut["id"]> = {
  heading1: "heading1",
  heading2: "heading2",
  heading3: "heading3",
  bulletList: "bulletList",
  orderedList: "orderedList",
  codeBlock: "codeBlock",
};

/**
 * Always-visible formatting bar of the editor in edit mode (KA Atlas): undo/redo, headings,
 * bold/italic/link, bulleted and numbered lists, callout, code, table and image. Tooltips show
 * the keyboard shortcut. The floating bubble menu and "/" stay available; buttons
 * keep the selection (mousedown is prevented) and every action has a keyboard shortcut or a "/" item.
 */
export function EditorToolbar({
  editor,
  onImage,
  end,
  onLink,
}: {
  editor: Editor;
  /** Opens the image dialog (the image item needs a URL first). */
  onImage: () => void;
  /**
   * Shown at the right end of the bar (the save status and "Done" of a page): the bar sticks
   * under the top bar, so they stay in reach however far the page is scrolled.
   */
  end?: ReactNode;
  /** Opens the link field of the bubble menu on the selection (same as Mod-K). */
  onLink: () => void;
}) {
  const t = useTranslations("editor");
  const text = useBlockText();
  const shortcut = useShortcutLabel();
  const withShortcut = (label: string, id: EditorShortcut["id"] | undefined) =>
    id ? t("toolbar.withShortcut", { label, keys: shortcut(id) }) : label;
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      blocks: BLOCKS.map(({ active }) => active(e)),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      link: e.isActive("link"),
      // The link field opens on a selection (or a link under the caret), like Mod-K.
      linkAvailable: !e.state.selection.empty || e.isActive("link"),
      undo: e.can().undo(),
      redo: e.can().redo(),
      table: itemById("table").available?.(e.state) ?? true,
    }),
  });

  const toggleBlock = (id: string, active: boolean) => {
    // Pressing an active block button goes back to a plain paragraph.
    turnInto(editor, itemById(active ? "paragraph" : id));
  };

  return (
    <div
      role="toolbar"
      aria-label={t("toolbar.label")}
      className="sticky top-16 z-30 mb-3 flex flex-wrap items-center gap-0.5 rounded-lg border bg-card p-1 shadow-xs md:ml-8"
    >
      <ToolbarButton
        label={t("shortcuts.items.undo")}
        title={withShortcut(t("shortcuts.items.undo"), "undo")}
        icon={Undo2Icon}
        disabled={!state.undo}
        onClick={() => editor.chain().focus().undo().run()}
      />
      <ToolbarButton
        label={t("shortcuts.items.redo")}
        title={withShortcut(t("shortcuts.items.redo"), "redo")}
        icon={Redo2Icon}
        disabled={!state.redo}
        onClick={() => editor.chain().focus().redo().run()}
      />
      <Divider />
      {BLOCKS.slice(0, 3).map(({ id }, index) => (
        <ToolbarButton
          key={id}
          label={text.title(itemById(id))}
          title={withShortcut(text.title(itemById(id)), BLOCK_SHORTCUTS[id])}
          icon={BLOCK_ICONS[id]}
          pressed={state.blocks[index]}
          onClick={() => toggleBlock(id, state.blocks[index] ?? false)}
        />
      ))}
      <Divider />
      <ToolbarButton
        label={t("bubble.bold")}
        title={withShortcut(t("bubble.bold"), "bold")}
        icon={BoldIcon}
        pressed={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolbarButton
        label={t("bubble.italic")}
        title={withShortcut(t("bubble.italic"), "italic")}
        icon={ItalicIcon}
        pressed={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolbarButton
        label={t("bubble.link")}
        title={state.linkAvailable ? withShortcut(t("bubble.link"), "link") : t("toolbar.linkHint")}
        icon={LinkIcon}
        pressed={state.link}
        disabled={!state.linkAvailable}
        onClick={() => {
          if (editor.state.selection.empty) editor.commands.extendMarkRange("link");
          onLink();
        }}
      />
      <Divider />
      {BLOCKS.slice(3).map(({ id }, index) => (
        <ToolbarButton
          key={id}
          label={text.title(itemById(id))}
          title={withShortcut(text.title(itemById(id)), BLOCK_SHORTCUTS[id])}
          icon={BLOCK_ICONS[id]}
          pressed={state.blocks[index + 3]}
          onClick={() => toggleBlock(id, state.blocks[index + 3] ?? false)}
        />
      ))}
      <ToolbarButton
        label={text.title(itemById("table"))}
        icon={BLOCK_ICONS.table}
        disabled={!state.table}
        onClick={() => itemById("table").run(editor.chain().focus()).run()}
      />
      <ToolbarButton
        label={text.title(itemById("image"))}
        icon={BLOCK_ICONS.image}
        onClick={onImage}
      />
      {end && <div className="ml-auto flex items-center gap-2 pl-2">{end}</div>}
    </div>
  );
}

function ToolbarButton({
  label,
  title = label,
  icon: Icon,
  pressed,
  disabled,
  onClick,
}: {
  label: string;
  /** Tooltip (defaults to the label), e.g. with the keyboard shortcut. */
  title?: string;
  icon: LucideIcon | undefined;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}): ReactNode {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={title}
      aria-pressed={pressed}
      disabled={disabled}
      // Keep the editor selection: the click must not move focus out of the text.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(pressed && "bg-accent text-accent-foreground")}
    >
      {Icon && <Icon aria-hidden />}
    </Button>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-border" />;
}
