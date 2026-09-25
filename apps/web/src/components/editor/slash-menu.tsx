"use client";

import {
  type SlashCommandOptions,
  type SlashItem,
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from "@kb/editor/ui";
import { ReactRenderer } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { cn } from "@/components/ui/utils";

import { BLOCK_ICONS, useBlockText } from "./block-types";

type SlashMenuProps = SuggestionProps<SlashItem, SlashItem>;

export type SlashMenuHandle = { onKeyDown: (props: SuggestionKeyDownProps) => boolean };

/**
 * List shown while typing "/query". Focus stays in the editor: arrows move the highlighted
 * item, Enter/Tab picks it, Escape closes (handled by the suggestion plugin).
 */
export const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(function SlashMenu(
  { items, command, loading },
  ref,
) {
  const t = useTranslations("editor.slash");
  const text = useBlockText();
  const [selected, setSelected] = useState(0);
  const [prevItems, setPrevItems] = useState(items);
  const listRef = useRef<HTMLDivElement>(null);

  // New query → highlight the first match again.
  if (prevItems !== items) {
    setPrevItems(items);
    setSelected(0);
  }

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false;
      if (event.key === "ArrowDown") {
        setSelected((index) => (index + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelected((index) => (index - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = items[selected];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  // Items resolve a tick after "/" is typed; do not flash the empty state meanwhile.
  if (loading && items.length === 0) return null;

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={t("label")}
      className="z-50 max-h-80 w-72 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {items.length === 0 ? (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        items.map((item, index) => {
          const Icon = BLOCK_ICONS[item.id];
          const showGroup = index === 0 || items[index - 1]?.group !== item.group;
          return (
            <div key={item.id}>
              {showGroup && (
                <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                  {t(`groups.${item.group}`)}
                </div>
              )}
              <button
                type="button"
                role="option"
                aria-selected={index === selected}
                data-index={index}
                tabIndex={-1}
                // Keep focus (and the selection) in the editor.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setSelected(index)}
                onClick={() => command(item)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left text-sm outline-none",
                  index === selected && "bg-accent text-accent-foreground",
                )}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
                  {Icon && <Icon className="size-4" aria-hidden />}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{text.title(item)}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {text.description(item)}
                  </span>
                </span>
              </button>
            </div>
          );
        })
      )}
    </div>
  );
});

/** `render` for the SlashCommand extension: mounts `SlashMenu` next to the "/" decoration. */
export const renderSlashMenu: NonNullable<SlashCommandOptions["render"]> = () => {
  let renderer: ReactRenderer<SlashMenuHandle, SlashMenuProps> | null = null;
  let unmount: (() => void) | null = null;

  return {
    onStart: (props) => {
      renderer = new ReactRenderer(SlashMenu, { props, editor: props.editor });
      unmount = props.mount(renderer.element as HTMLElement);
    },
    onUpdate: (props) => renderer?.updateProps(props),
    onKeyDown: (props) => renderer?.ref?.onKeyDown(props) ?? false,
    onExit: () => {
      unmount?.();
      renderer?.destroy();
      renderer = null;
      unmount = null;
    },
  };
};
