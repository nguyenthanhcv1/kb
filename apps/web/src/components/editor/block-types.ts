import type { Editor } from "@tiptap/core";
import { MERMAID_LANGUAGE, type SlashItem, SLASH_ITEMS } from "@kb/editor/ui";
import {
  CircleCheckIcon,
  Heading1Icon,
  Heading2Icon,
  FileIcon,
  FileUpIcon,
  Heading3Icon,
  ImageIcon,
  InfoIcon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  type LucideIcon,
  MinusIcon,
  NetworkIcon,
  OctagonAlertIcon,
  PilcrowIcon,
  QuoteIcon,
  SquareCodeIcon,
  TableIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

/** Icon per slash item id (`SLASH_ITEMS`). */
export const BLOCK_ICONS: Record<string, LucideIcon> = {
  paragraph: PilcrowIcon,
  heading1: Heading1Icon,
  heading2: Heading2Icon,
  heading3: Heading3Icon,
  bulletList: ListIcon,
  orderedList: ListOrderedIcon,
  taskList: ListTodoIcon,
  blockquote: QuoteIcon,
  codeBlock: SquareCodeIcon,
  mermaid: NetworkIcon,
  "callout.info": InfoIcon,
  "callout.success": CircleCheckIcon,
  "callout.warning": TriangleAlertIcon,
  "callout.danger": OctagonAlertIcon,
  divider: MinusIcon,
  table: TableIcon,
  image: ImageIcon,
  file: FileIcon,
  markdown: FileUpIcon,
};

/**
 * Blocks offered by "Turn into" (bubble menu, block menu): blocks that can replace the current
 * one. Dividers, tables and images are inserted, not converted.
 */
export const TURN_INTO_ITEMS: readonly SlashItem[] = SLASH_ITEMS.filter(
  (item) => item.id !== "divider" && item.id !== "table" && !item.input,
);

/** Converts the block holding the selection into `item` (lists/quotes/callouts are lifted first). */
export function turnInto(editor: Editor, item: SlashItem) {
  item.run(editor.chain().focus().clearNodes()).run();
}

/** The `TURN_INTO_ITEMS` entry matching the block at the selection, if any. */
export function activeBlockItem(editor: Editor): SlashItem | undefined {
  const checks: [string, () => boolean][] = [
    ["heading1", () => editor.isActive("heading", { level: 1 })],
    ["heading2", () => editor.isActive("heading", { level: 2 })],
    ["heading3", () => editor.isActive("heading", { level: 3 })],
    ["taskList", () => editor.isActive("taskList")],
    ["orderedList", () => editor.isActive("orderedList")],
    ["bulletList", () => editor.isActive("bulletList")],
    ["mermaid", () => editor.isActive("codeBlock", { language: MERMAID_LANGUAGE })],
    ["codeBlock", () => editor.isActive("codeBlock")],
    ["blockquote", () => editor.isActive("blockquote")],
    ["callout.info", () => editor.isActive("callout", { variant: "info" })],
    ["callout.success", () => editor.isActive("callout", { variant: "success" })],
    ["callout.warning", () => editor.isActive("callout", { variant: "warning" })],
    ["callout.danger", () => editor.isActive("callout", { variant: "danger" })],
  ];
  const id = checks.find(([, check]) => check())?.[0] ?? "paragraph";
  return TURN_INTO_ITEMS.find((item) => item.id === id);
}

/** Translated title/description of a slash item (`editor.slash.items.<id>`). */
export function useBlockText() {
  const t = useTranslations("editor.slash.items") as unknown as (key: string) => string;
  const title = useCallback((item: SlashItem) => t(`${item.id}.title`), [t]);
  const description = useCallback((item: SlashItem) => t(`${item.id}.description`), [t]);
  return { title, description };
}
