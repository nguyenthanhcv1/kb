import type { ChainedCommands, CommandProps } from "@tiptap/core";
import { type EditorState, TextSelection } from "@tiptap/pm/state";
import { normalizeVi } from "@kb/i18n";

import { CALLOUT_VARIANTS, type CalloutVariant } from "../extensions/callout";
import { DEFAULT_TABLE_SIZE } from "../extensions/table";
import { MERMAID_LANGUAGE, MERMAID_TEMPLATE } from "./mermaid";
import { findTable } from "./table-actions";

export const SLASH_GROUPS = ["basic", "lists", "blocks", "media"] as const;
export type SlashGroup = (typeof SLASH_GROUPS)[number];

/** Input the UI must collect before an item can run (e.g. an image URL). */
export type SlashItemInput = { kind: "imageUrl" } | { kind: "file" } | { kind: "markdownFile" };

export interface SlashItem {
  /** Stable code; the UI maps it to a label/description (`editor.slash.items.<id>`) and an icon. */
  id: string;
  group: SlashGroup;
  /**
   * Extra search terms in both languages (Vietnamese without accents is fine — matching folds
   * accents). The translated label is always searched too.
   */
  keywords: readonly string[];
  /** Set when the UI must ask for something before calling `run`. */
  input?: SlashItemInput;
  /** Hides the item where it cannot be used (e.g. no table inside a table). Default: shown. */
  available?: (state: EditorState) => boolean;
  /** Appends the block command to a chain that already removed the "/query" text. */
  run: (chain: ChainedCommands, input?: { src?: string }) => ChainedCommands;
}

/**
 * After inserting an atom block (image), put the caret in the paragraph right after it — creating
 * one if needed — so the next keystroke does not replace the node.
 */
const caretAfterSelectedNode = ({ tr }: CommandProps) => {
  const after = tr.selection.to;
  if (!tr.doc.resolve(after).nodeAfter?.isTextblock) {
    tr.insert(after, tr.doc.type.schema.nodes.paragraph!.create());
  }
  tr.setSelection(TextSelection.create(tr.doc, after + 1));
  return true;
};

const calloutKeywords: Record<CalloutVariant, readonly string[]> = {
  info: ["info", "thong tin", "ghi chu", "note"],
  success: ["success", "thanh cong", "tip", "meo"],
  warning: ["warning", "canh bao", "luu y", "caution"],
  danger: ["danger", "nguy hiem", "loi", "error"],
};

/**
 * Every block a user can insert with "/" (docs/PLAN.md §9, T3.2). Order = menu order.
 * Adding a block type to the schema → add an item here (a test checks the coverage).
 */
export const SLASH_ITEMS: readonly SlashItem[] = [
  {
    id: "paragraph",
    group: "basic",
    keywords: ["text", "paragraph", "van ban", "doan van", "p"],
    run: (chain) => chain.setParagraph(),
  },
  ...([1, 2, 3] as const).map((level): SlashItem => ({
    id: `heading${level}`,
    group: "basic",
    keywords: ["heading", "title", "tieu de", `h${level}`],
    run: (chain) => chain.setHeading({ level }),
  })),
  {
    id: "bulletList",
    group: "lists",
    keywords: ["bullet", "list", "unordered", "danh sach", "gach dau dong", "ul"],
    run: (chain) => chain.toggleBulletList(),
  },
  {
    id: "orderedList",
    group: "lists",
    keywords: ["numbered", "ordered", "list", "danh sach", "so thu tu", "ol"],
    run: (chain) => chain.toggleOrderedList(),
  },
  {
    id: "taskList",
    group: "lists",
    keywords: ["todo", "task", "checkbox", "checklist", "viec can lam", "cong viec"],
    run: (chain) => chain.toggleTaskList(),
  },
  {
    id: "blockquote",
    group: "blocks",
    keywords: ["quote", "blockquote", "trich dan"],
    run: (chain) => chain.toggleBlockquote(),
  },
  {
    id: "codeBlock",
    group: "blocks",
    keywords: ["code", "snippet", "ma nguon", "doan ma", "```"],
    run: (chain) => chain.setCodeBlock(),
  },
  {
    id: "mermaid",
    group: "blocks",
    keywords: ["mermaid", "diagram", "flowchart", "chart", "so do", "luu do", "bieu do", "uml"],
    // A code block in the "mermaid" language, filled with a starter diagram the view draws (T7.14).
    run: (chain) =>
      chain.setCodeBlock({ language: MERMAID_LANGUAGE }).command(({ tr, dispatch }) => {
        const { $from } = tr.selection;
        if (dispatch && $from.parent.content.size === 0) tr.insertText(MERMAID_TEMPLATE, $from.pos);
        return true;
      }),
  },
  ...CALLOUT_VARIANTS.map((variant): SlashItem => ({
    id: `callout.${variant}`,
    group: "blocks",
    keywords: ["callout", "panel", "khung", ...calloutKeywords[variant]],
    run: (chain) => chain.setCallout({ variant }),
  })),
  {
    id: "divider",
    group: "blocks",
    keywords: ["divider", "separator", "horizontal rule", "hr", "duong ke", "phan cach", "---"],
    run: (chain) => chain.setHorizontalRule(),
  },
  {
    id: "table",
    group: "blocks",
    keywords: ["table", "grid", "bang", "bang bieu", "luoi", "spreadsheet"],
    // Nested tables are allowed by the schema (pasted HTML) but not offered: they break CSV
    // export and row/column drag.
    available: (state) => findTable(state) === null,
    run: (chain) => chain.insertTable({ ...DEFAULT_TABLE_SIZE }),
  },
  {
    id: "image",
    group: "media",
    keywords: ["image", "picture", "photo", "hinh", "anh", "img"],
    input: { kind: "imageUrl" },
    run: (chain, input) =>
      input?.src ? chain.setImage({ src: input.src }).command(caretAfterSelectedNode) : chain,
  },
  {
    id: "file",
    group: "media",
    keywords: ["file", "attachment", "upload", "pdf", "tep", "dinh kem", "tai len"],
    input: { kind: "file" },
    // The UI opens a file picker; the upload inserts the link itself (`insertAttachment`).
    run: (chain) => chain,
  },
  {
    id: "markdown",
    group: "media",
    keywords: ["markdown", "md", "import", "nhap", "tai len", "tai lieu", "readme"],
    input: { kind: "markdownFile" },
    // The UI opens a file picker for a .md file and inserts its blocks itself (`insertMarkdown`).
    run: (chain) => chain,
  },
];

/**
 * Items whose translated label or keywords contain every word of `query`, ignoring case and
 * Vietnamese accents ("tieu de" finds "Tiêu đề 1"). Items whose label starts with the query
 * come first; otherwise menu order is kept.
 */
export function filterSlashItems(
  items: readonly SlashItem[],
  query: string,
  getLabel: (item: SlashItem) => string,
): SlashItem[] {
  const words = normalizeVi(query).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...items];

  const scored = items.flatMap((item, index) => {
    const label = normalizeVi(getLabel(item));
    const haystack = [label, item.id.toLowerCase(), ...item.keywords.map(normalizeVi)].join(" ");
    if (!words.every((word) => haystack.includes(word))) return [];
    return [{ item, index, rank: label.startsWith(words.join(" ")) ? 0 : 1 }];
  });
  return scored.sort((a, b) => a.rank - b.rank || a.index - b.index).map(({ item }) => item);
}
