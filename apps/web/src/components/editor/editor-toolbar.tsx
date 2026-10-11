"use client";

import { SLASH_ITEMS, type SlashItem } from "@kb/editor/ui";
import { type Editor, useEditorState } from "@tiptap/react";
import { BoldIcon, ItalicIcon, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/utils";

import { BLOCK_ICONS, turnInto, useBlockText } from "./block-types";

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
  { id: "callout.info", active: (e) => e.isActive("callout") },
  { id: "codeBlock", active: (e) => e.isActive("codeBlock") },
];

/**
 * Always-visible formatting bar of the editor in edit mode (KA Atlas): headings, bold/italic,
 * list, callout, code, table and image. The floating bubble menu and "/" stay available; buttons
 * keep the selection (mousedown is prevented) and every action has a keyboard shortcut or a "/" item.
 */
export function EditorToolbar({
  editor,
  onImage,
}: {
  editor: Editor;
  /** Opens the image dialog (the image item needs a URL first). */
  onImage: () => void;
}) {
  const t = useTranslations("editor");
  const text = useBlockText();
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      blocks: BLOCKS.map(({ active }) => active(e)),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
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
      {BLOCKS.slice(0, 3).map(({ id }, index) => (
        <ToolbarButton
          key={id}
          label={text.title(itemById(id))}
          icon={BLOCK_ICONS[id]}
          pressed={state.blocks[index]}
          onClick={() => toggleBlock(id, state.blocks[index] ?? false)}
        />
      ))}
      <Divider />
      <ToolbarButton
        label={t("bubble.bold")}
        icon={BoldIcon}
        pressed={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolbarButton
        label={t("bubble.italic")}
        icon={ItalicIcon}
        pressed={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <Divider />
      {BLOCKS.slice(3).map(({ id }, index) => (
        <ToolbarButton
          key={id}
          label={text.title(itemById(id))}
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
    </div>
  );
}

function ToolbarButton({
  label,
  icon: Icon,
  pressed,
  disabled,
  onClick,
}: {
  label: string;
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
      title={label}
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
