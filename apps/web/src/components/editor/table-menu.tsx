"use client";

import {
  CELL_BACKGROUND_COLORS,
  type CellBackgroundColor,
  CSV_MIME_TYPE,
  findTable,
  getTableMenuState,
  setCellBackground,
  TABLE_ACTIONS,
  type TableAction,
  type TableActionGroup,
  type TableActionId,
  tableCsvExport,
} from "@kb/editor/ui";
import { type Editor, useEditorState } from "@tiptap/react";
import {
  BetweenHorizontalEndIcon,
  BetweenHorizontalStartIcon,
  BetweenVerticalEndIcon,
  BetweenVerticalStartIcon,
  ChevronDownIcon,
  Columns2Icon,
  FileDownIcon,
  Grid2x2XIcon,
  type LucideIcon,
  PaintBucketIcon,
  PanelLeftIcon,
  PanelTopIcon,
  Rows2Icon,
  TableCellsMergeIcon,
  TableCellsSplitIcon,
  TableIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/components/ui/utils";

import { useShortcutLabel } from "./shortcuts-dialog";

/** Icon per table action (`TABLE_ACTIONS`). */
export const TABLE_ACTION_ICONS: Record<TableActionId, LucideIcon> = {
  addRowBefore: BetweenHorizontalStartIcon,
  addRowAfter: BetweenHorizontalEndIcon,
  deleteRow: Rows2Icon,
  addColumnBefore: BetweenVerticalStartIcon,
  addColumnAfter: BetweenVerticalEndIcon,
  deleteColumn: Columns2Icon,
  mergeCells: TableCellsMergeIcon,
  splitCell: TableCellsSplitIcon,
  toggleHeaderRow: PanelTopIcon,
  toggleHeaderColumn: PanelLeftIcon,
  deleteTable: Grid2x2XIcon,
};

/** Value of the "no colour" radio item in the cell colour menu. */
const NO_BACKGROUND = "none";

/**
 * Colour swatch of a palette code. Its colour comes from `editor.css`
 * (`.kb-cell-swatch[data-background-color]`), the same theme-aware rule as the cells.
 */
function CellColorSwatch({ color }: { color: CellBackgroundColor | null }) {
  return (
    <span
      aria-hidden
      className="kb-cell-swatch size-4 shrink-0 rounded-sm border border-border"
      data-background-color={color ?? undefined}
    />
  );
}

/** Actions also shown as icon buttons next to the menu (the rest live in the menu only). */
const QUICK_ACTIONS: readonly TableActionId[] = ["addRowAfter", "addColumnAfter"];

const action = (id: TableActionId) => TABLE_ACTIONS.find((a) => a.id === id)!;

/** Saves `text` as a download named `fileName` (Blob + temporary link). */
export function downloadTextFile(text: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Downloads the table holding the selection as CSV (T4.5: RFC 4180, UTF-8 BOM, file name from the
 * page title without accents). Returns `false` outside a table.
 */
export function exportTableCsv(editor: Editor, pageTitle: string | undefined): boolean {
  const result = tableCsvExport(editor.state, pageTitle);
  if (!result) return false;
  downloadTextFile(result.csv, result.fileName, CSV_MIME_TYPE);
  return true;
}

/** Keeps the editor focused (and its selection) when a toolbar button is pressed with a mouse. */
const keepEditorFocus = (event: MouseEvent) => event.preventDefault();

export type TableMenuProps = {
  editor: Editor;
  /** Page title, used for the CSV file name. */
  pageTitle?: string;
  /** Incremented to move keyboard focus into the toolbar (Alt-F10). */
  focusRequest: number;
};

/**
 * Toolbar floating above the table that holds the selection: a "Table" menu with every action
 * (rows, columns, cells — merge, split, background colour —, header row/column, CSV export,
 * delete) plus quick buttons. Keyboard: Alt-F10
 * focuses it, arrow keys / Home / End move between buttons, Escape returns to the editor.
 */
export function TableMenu({ editor, pageTitle, focusRequest }: TableMenuProps) {
  const t = useTranslations("table");
  const shortcut = useShortcutLabel();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const menuOpenRef = useRef(false);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => getTableMenuState(e),
  });
  const visible = state.inTable && editor.isEditable;

  /** Puts the toolbar on the top-left corner of the table, relative to `.kb-editor`. */
  const place = useCallback(() => {
    const table = findTable(editor.state);
    const container = editor.view.dom.closest<HTMLElement>(".kb-editor");
    const dom = table ? (editor.view.nodeDOM(table.pos) as HTMLElement | null) : null;
    if (!table || !container || !dom?.getBoundingClientRect) {
      setPosition(null);
      return;
    }
    const box = dom.getBoundingClientRect();
    const origin = container.getBoundingClientRect();
    setPosition((previous) => {
      const next = { top: box.top - origin.top, left: Math.max(0, box.left - origin.left) };
      return previous?.top === next.top && previous.left === next.left ? previous : next;
    });
  }, [editor]);

  // Re-measure after every transaction (typing, new rows) and window resize, once per frame.
  useEffect(() => {
    if (!visible) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    schedule();
    editor.on("transaction", schedule);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      editor.off("transaction", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [editor, visible, place]);

  const items = () =>
    Array.from(toolbarRef.current?.querySelectorAll<HTMLElement>("[data-toolbar-item]") ?? []);

  // Alt-F10 from the editor: focus the menu button (its onFocus makes it the tab stop).
  useEffect(() => {
    if (focusRequest === 0) return;
    const frame = requestAnimationFrame(() =>
      toolbarRef.current?.querySelector<HTMLElement>("[data-toolbar-item]")?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);

  const onToolbarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items().filter((el) => !(el as HTMLButtonElement).disabled);
    const index = list.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % list.length;
        break;
      case "ArrowLeft":
        next = (index - 1 + list.length) % list.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = list.length - 1;
        break;
      case "Escape":
        event.preventDefault();
        editor.view.focus();
        return;
      default:
        return;
    }
    event.preventDefault();
    list[next]?.focus();
  };

  if (!visible) return null;

  const runAction = (item: TableAction) => {
    item.run(editor);
  };

  const groups: { group: TableActionGroup; actions: TableAction[] }[] = [
    { group: "rows", actions: TABLE_ACTIONS.filter((a) => a.group === "rows") },
    { group: "columns", actions: TABLE_ACTIONS.filter((a) => a.group === "columns") },
    { group: "cells", actions: TABLE_ACTIONS.filter((a) => a.group === "cells") },
  ];
  const toggles = TABLE_ACTIONS.filter((a) => a.group === "header");
  const DeleteIcon = TABLE_ACTION_ICONS.deleteTable;

  /** Props of the button at `index` in the toolbar (roving tab stop). */
  const itemProps = (index: number) => ({
    "data-toolbar-item": "",
    tabIndex: index === activeIndex ? 0 : -1,
    onFocus: () => setActiveIndex(index),
  });

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label={t("menu.label")}
      aria-orientation="horizontal"
      data-testid="table-menu"
      onKeyDown={onToolbarKeyDown}
      style={position ? { top: position.top, left: position.left } : undefined}
      className={cn(
        "absolute z-30 flex max-w-full translate-y-[calc(-100%_-_0.25rem)] items-center gap-0.5 overflow-x-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md",
        !position && "invisible",
      )}
    >
      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          menuOpenRef.current = open;
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1 px-2"
            aria-label={t("menu.options")}
            {...itemProps(0)}
          >
            <TableIcon className="size-4" aria-hidden />
            <span className="hidden sm:inline">{t("menu.trigger")}</span>
            <ChevronDownIcon className="size-3.5 opacity-60" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-64"
          aria-label={t("menu.options")}
          // Give the keyboard back to the editor once an action ran.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // Runs after the exit animation: skip it when the menu was reopened meanwhile, or
            // the editor would take the focus back and close the new menu.
            if (!menuOpenRef.current && !editor.isDestroyed) editor.view.focus();
          }}
        >
          {groups.map(({ group, actions }) => (
            <DropdownMenuGroup key={group}>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {t(`groups.${group}`)}
              </DropdownMenuLabel>
              {actions.map((item) => {
                const Icon = TABLE_ACTION_ICONS[item.id];
                return (
                  <DropdownMenuItem
                    key={item.id}
                    disabled={!state.enabled[item.id]}
                    onSelect={() => runAction(item)}
                  >
                    <Icon aria-hidden />
                    {t(`actions.${item.id}`)}
                    {item.id === "addRowAfter" && (
                      <DropdownMenuShortcut>{shortcut("addRowBelow")}</DropdownMenuShortcut>
                    )}
                  </DropdownMenuItem>
                );
              })}
              {group === "cells" && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger
                    disabled={!state.canSetCellBackground}
                    data-testid="table-cell-color"
                  >
                    <PaintBucketIcon aria-hidden />
                    {t("actions.cellBackground")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-44" aria-label={t("actions.cellBackground")}>
                    <DropdownMenuRadioGroup
                      value={
                        state.cellBackground === "mixed"
                          ? ""
                          : (state.cellBackground ?? NO_BACKGROUND)
                      }
                      onValueChange={(value) =>
                        setCellBackground(
                          editor,
                          value === NO_BACKGROUND ? null : (value as CellBackgroundColor),
                        )
                      }
                    >
                      <DropdownMenuRadioItem value={NO_BACKGROUND}>
                        <CellColorSwatch color={null} />
                        {t("colors.none")}
                      </DropdownMenuRadioItem>
                      {CELL_BACKGROUND_COLORS.map((color) => (
                        <DropdownMenuRadioItem key={color} value={color}>
                          <CellColorSwatch color={color} />
                          {t(`colors.${color}`)}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
            </DropdownMenuGroup>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t("groups.header")}
            </DropdownMenuLabel>
            {toggles.map((item) => (
              <DropdownMenuCheckboxItem
                key={item.id}
                checked={item.toggle ? state.checked[item.toggle] : false}
                disabled={!state.enabled[item.id]}
                onCheckedChange={() => runAction(item)}
              >
                {t(`actions.${item.id}`)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => exportTableCsv(editor, pageTitle)}>
            <FileDownIcon aria-hidden />
            {t("actions.exportCsv")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={!state.enabled.deleteTable}
            onSelect={() => runAction(action("deleteTable"))}
          >
            <DeleteIcon aria-hidden />
            {t("actions.deleteTable")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Separator orientation="vertical" className="mx-0.5 h-6" />
      {QUICK_ACTIONS.map((id, index) => {
        const Icon = TABLE_ACTION_ICONS[id];
        return (
          <Button
            key={id}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t(`actions.${id}`)}
            title={t(`actions.${id}`)}
            disabled={!state.enabled[id]}
            onMouseDown={keepEditorFocus}
            onClick={() => runAction(action(id))}
            {...itemProps(index + 1)}
          >
            <Icon className="size-4" aria-hidden />
          </Button>
        );
      })}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("actions.exportCsv")}
        title={t("actions.exportCsv")}
        onMouseDown={keepEditorFocus}
        onClick={() => exportTableCsv(editor, pageTitle)}
        {...itemProps(QUICK_ACTIONS.length + 1)}
      >
        <FileDownIcon className="size-4" aria-hidden />
      </Button>
      <Separator orientation="vertical" className="mx-0.5 h-6" />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive"
        aria-label={t("actions.deleteTable")}
        title={t("actions.deleteTable")}
        disabled={!state.enabled.deleteTable}
        onMouseDown={keepEditorFocus}
        onClick={() => runAction(action("deleteTable"))}
        {...itemProps(QUICK_ACTIONS.length + 2)}
      >
        <DeleteIcon className="size-4" aria-hidden />
      </Button>
    </div>
  );
}
