"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronRightIcon,
  FileTextIcon,
  LinkIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { memo, type KeyboardEvent, type MouseEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/components/ui/utils";
import { PAGE_TITLE_MAX_LENGTH, type PageTreeNode } from "@/server/pages";

import type { FlatItem } from "./tree-model";

/** Indentation per level (px) — also the horizontal drag distance that changes the depth. */
export const TREE_INDENT = 16;

/** Stable callbacks shared by every row (the tree keeps them in a ref). */
export type RowHandlers = {
  registerRef(id: string, element: HTMLElement | null): void;
  onKeyDown(event: KeyboardEvent<HTMLElement>, id: string): void;
  onFocus(id: string): void;
  onClick(event: MouseEvent<HTMLElement>): void;
  toggle(id: string): void;
  setMenuOpen(id: string, open: boolean): void;
  afterMenuClose(id: string): void;
  addSubpage(id: string): void;
  startRename(id: string): void;
  commitRename(id: string, title: string | null): void;
  copyLink(id: string): void;
  moveToTrash(id: string): void;
};

type RowProps = {
  item: FlatItem;
  node: PageTreeNode;
  href: string;
  /** The page open in the main area. */
  current: boolean;
  /** Roving tabindex: the one row reachable with Tab. */
  tabbable: boolean;
  /** Visual depth (the drop projection while this row is dragged). */
  depth: number;
  loading: boolean;
  renaming: boolean;
  menuOpen: boolean;
  canEdit: boolean;
  handlers: RowHandlers;
};

function sameItem(a: FlatItem, b: FlatItem): boolean {
  return (
    a.id === b.id &&
    a.parentId === b.parentId &&
    a.depth === b.depth &&
    a.posInSet === b.posInSet &&
    a.setSize === b.setSize &&
    a.hasChildren === b.hasChildren &&
    a.expanded === b.expanded
  );
}

function sameProps<P extends { item: FlatItem }>(a: P, b: P): boolean {
  return (Object.keys(a) as (keyof P)[]).every((key) =>
    key === "item" ? sameItem(a.item, b.item) : a[key] === b[key],
  );
}

/**
 * One row of the page tree. The sortable wrapper re-renders on every drag frame; the row body is
 * memoised separately so dragging among hundreds of pages only re-renders cheap `<li>`s.
 */
export const PageTreeRow = memo(function PageTreeRow({ depth, ...props }: RowProps) {
  const { item, canEdit, renaming, handlers, current } = props;
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !canEdit || renaming,
  });

  return (
    <li
      ref={setNodeRef}
      role="none"
      data-page-id={item.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...listeners}
      onContextMenu={(event) => {
        event.preventDefault();
        handlers.setMenuOpen(item.id, true);
      }}
      className={cn(
        "group/row relative flex h-8 touch-manipulation items-center gap-0.5 rounded-md pr-1 text-sm select-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        current && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
        isDragging && "z-10 border border-dashed border-ring bg-sidebar-accent/60 opacity-70",
      )}
    >
      <span aria-hidden className="shrink-0" style={{ width: depth * TREE_INDENT }} />
      <RowBody {...props} />
    </li>
  );
}, sameProps);

const RowBody = memo(function RowBody({
  item,
  node,
  href,
  current,
  tabbable,
  loading,
  renaming,
  menuOpen,
  canEdit,
  handlers,
}: Omit<RowProps, "depth">) {
  const t = useTranslations("tree");
  const title = node.title || t("untitled");
  const moreButton = (
    // Mouse/touch affordance; keyboard users open the menu with Shift+F10 on the row.
    <Button
      variant="ghost"
      size="icon-xs"
      tabIndex={-1}
      aria-hidden
      title={t("actions.more", { title })}
      onClick={menuOpen ? undefined : () => handlers.setMenuOpen(item.id, true)}
      className={cn(
        "shrink-0 text-muted-foreground opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100",
        renaming && "hidden",
      )}
    >
      <MoreHorizontalIcon />
    </Button>
  );

  return (
    <>
      <span
        aria-hidden
        title={item.hasChildren ? (item.expanded ? t("collapse") : t("expand")) : undefined}
        onClick={() => item.hasChildren && handlers.toggle(item.id)}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground",
          item.hasChildren && "cursor-pointer hover:bg-sidebar-border",
        )}
      >
        {loading ? (
          <Loader2Icon className="size-3.5 animate-spin" />
        ) : item.hasChildren ? (
          <ChevronRightIcon
            className={cn("size-3.5 transition-transform", item.expanded && "rotate-90")}
          />
        ) : null}
      </span>

      {renaming ? (
        <RenameInput
          initial={node.title}
          onDone={(value) => handlers.commitRename(item.id, value)}
        />
      ) : (
        <Link
          href={href}
          ref={(element) => handlers.registerRef(item.id, element)}
          role="treeitem"
          aria-level={item.depth + 1}
          aria-setsize={item.setSize}
          aria-posinset={item.posInSet}
          aria-expanded={item.hasChildren ? item.expanded : undefined}
          aria-current={current ? "page" : undefined}
          aria-busy={loading || undefined}
          tabIndex={tabbable ? 0 : -1}
          draggable={false}
          onKeyDown={(event) => handlers.onKeyDown(event, item.id)}
          onFocus={() => handlers.onFocus(item.id)}
          onClick={handlers.onClick}
          className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {node.icon ? (
            <span aria-hidden className="shrink-0 text-base leading-none">
              {node.icon}
            </span>
          ) : (
            <FileTextIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className={cn("truncate", !node.title && "text-muted-foreground")}>{title}</span>
        </Link>
      )}

      {/* The menu is mounted only while open: hundreds of idle Radix menus would slow the tree. */}
      {menuOpen ? (
        <DropdownMenu open onOpenChange={(open) => handlers.setMenuOpen(item.id, open)}>
          <DropdownMenuTrigger asChild>{moreButton}</DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            aria-label={t("actions.more", { title })}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              handlers.afterMenuClose(item.id);
            }}
          >
            {canEdit && (
              <>
                <DropdownMenuItem onSelect={() => handlers.addSubpage(item.id)}>
                  <PlusIcon aria-hidden />
                  {t("actions.addSubpage")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handlers.startRename(item.id)}>
                  <PencilIcon aria-hidden />
                  {t("actions.rename")}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem onSelect={() => handlers.copyLink(item.id)}>
              <LinkIcon aria-hidden />
              {t("actions.copyLink")}
            </DropdownMenuItem>
            {canEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => handlers.moveToTrash(item.id)}
                >
                  <Trash2Icon aria-hidden />
                  {t("actions.moveToTrash")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        moreButton
      )}
    </>
  );
}, sameProps);

/** Inline title editor: Enter or blur saves, Escape cancels (`onDone(null)`). */
function RenameInput({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (value: string | null) => void;
}) {
  const t = useTranslations("tree");
  const [value, setValue] = useState(initial);
  const [done, setDone] = useState(false);
  const finish = (result: string | null) => {
    if (done) return;
    setDone(true);
    onDone(result);
  };
  return (
    <Input
      autoFocus
      value={value}
      maxLength={PAGE_TITLE_MAX_LENGTH}
      aria-label={t("renameLabel")}
      placeholder={t("untitled")}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finish(value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(null);
        }
      }}
      onBlur={() => finish(value)}
      className="h-7 min-w-0 flex-1 px-1.5 py-0 text-sm md:text-sm"
    />
  );
}
