"use client";

import { deleteBlock, duplicateBlock, moveBlock } from "@kb/editor/ui";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  GripVerticalIcon,
  Repeat2Icon,
  Trash2Icon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { BLOCK_ICONS, TURN_INTO_ITEMS, turnInto, useBlockText } from "./block-types";
import { useShortcutLabel } from "./shortcuts-dialog";

/**
 * Grip shown left of the hovered block: drag to reorder, click for the block menu (move,
 * duplicate, turn into, delete). Keyboard users get the same actions through shortcuts.
 */
export function BlockHandle({ editor }: { editor: Editor }) {
  const t = useTranslations("editor.blockMenu");
  const text = useBlockText();
  const shortcut = useShortcutLabel();
  const posRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  /** Tables are not converted into other blocks: no "Turn into" for them. */
  const [convertible, setConvertible] = useState(true);

  const setLocked = (locked: boolean) => editor.commands.setMeta("lockDragHandle", locked);

  /** Runs `action` on the hovered block (read at click time, not during render). */
  const runOnBlock = (action: (pos: number) => void) => {
    const pos = posRef.current;
    if (pos !== null && editor.state.doc.nodeAt(pos)) action(pos);
  };

  return (
    <DragHandle
      editor={editor}
      className="kb-drag-handle"
      onNodeChange={({ node, pos }) => {
        posRef.current = pos >= 0 ? pos : null;
        setConvertible(node?.type.name !== "table");
      }}
    >
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          setLocked(next);
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("handle")}
            title={t("handle")}
            className="flex h-6 w-5 cursor-grab items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing"
          >
            <GripVerticalIcon className="size-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="left"
          align="start"
          className="w-64"
          aria-label={t("label")}
          // Give the keyboard back to the editor (not the grip) once an action ran.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            editor.commands.focus();
          }}
        >
          <DropdownMenuLabel className="sr-only">{t("label")}</DropdownMenuLabel>
          {convertible && (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Repeat2Icon aria-hidden />
                  {t("turnInto")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                  {TURN_INTO_ITEMS.map((item) => {
                    const Icon = BLOCK_ICONS[item.id];
                    return (
                      <DropdownMenuItem
                        key={item.id}
                        onSelect={() =>
                          runOnBlock((pos) => {
                            const selection = TextSelection.near(editor.state.doc.resolve(pos + 1));
                            editor.view.dispatch(editor.state.tr.setSelection(selection));
                            turnInto(editor, item);
                          })
                        }
                      >
                        {Icon && <Icon aria-hidden />}
                        {text.title(item)}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={() => runOnBlock((pos) => moveBlock(editor, pos, "up"))}>
            <ArrowUpIcon aria-hidden />
            {t("moveUp")}
            <DropdownMenuShortcut>{shortcut("moveUp")}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => runOnBlock((pos) => moveBlock(editor, pos, "down"))}>
            <ArrowDownIcon aria-hidden />
            {t("moveDown")}
            <DropdownMenuShortcut>{shortcut("moveDown")}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => runOnBlock((pos) => duplicateBlock(editor, pos))}>
            <CopyIcon aria-hidden />
            {t("duplicate")}
            <DropdownMenuShortcut>{shortcut("duplicate")}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => runOnBlock((pos) => deleteBlock(editor, pos))}
          >
            <Trash2Icon aria-hidden />
            {t("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </DragHandle>
  );
}
