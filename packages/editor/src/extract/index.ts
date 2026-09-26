import type { JSONContent } from "@tiptap/core";

/**
 * Derived, plain-text views of a page document (docs/PLAN.md §3.2 `page_documents`, §4.5).
 *
 * Every piece of text lands in exactly one field, so the search index can weight them
 * separately and report `match_in` (`heading` / `table` / `body`) without double counting.
 * All strings are Unicode NFC.
 */
export interface ExtractedContent {
  /** Body text outside headings and tables: one line per text block, `\n`-separated. */
  contentText: string;
  /** Heading texts, one per line, in document order. */
  headingsText: string;
  /** Tables: each row's cells joined by ` | `, rows by `\n`, tables separated by a blank line. */
  tableText: string;
  /** Words in all three fields. */
  wordCount: number;
  /** Outline for deep links / table of contents (`id` = stable block ID when assigned). */
  headings: ExtractedHeading[];
}

export interface ExtractedHeading {
  id: string | null;
  level: number;
  text: string;
}

/** Separator between cells of a table row in `tableText`. */
export const TABLE_CELL_SEPARATOR = " | ";

const TABLE_TYPES = new Set(["table"]);
const ROW_TYPES = new Set(["tableRow"]);
const CELL_TYPES = new Set(["tableCell", "tableHeader"]);
const LINE_BREAK_TYPES = new Set(["hardBreak"]);

// Letters/digits, allowing inner joiners so `NV-00123`, `e-mail`, `3.14`, `don't` count as one word.
const WORD_PATTERN = /[\p{L}\p{M}\p{N}]+(?:[-'’.][\p{L}\p{M}\p{N}]+)*/gu;

/** Collapse whitespace inside a line and normalise to NFC. */
function cleanLine(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

function isTextContainer(node: JSONContent): boolean {
  return (node.content ?? []).some(
    (child) => child.type === "text" || LINE_BREAK_TYPES.has(child.type ?? ""),
  );
}

/** Text of a text block, split into lines at hard breaks and newlines (code blocks). */
function inlineLines(node: JSONContent): string[] {
  let raw = "";
  for (const child of node.content ?? []) {
    if (child.type === "text") raw += child.text ?? "";
    else if (LINE_BREAK_TYPES.has(child.type ?? "")) raw += "\n";
    else raw += inlineLines(child).join(" ");
  }
  return raw.split("\n").map(cleanLine).filter(Boolean);
}

/** Text a leaf block contributes without inline content (e.g. image alt text). */
function leafText(node: JSONContent): string {
  if (node.type !== "image") return "";
  const alt = node.attrs?.alt;
  return typeof alt === "string" ? cleanLine(alt) : "";
}

/** All text below a node as lines (used for table cells and generic blocks). */
function blockLines(node: JSONContent): string[] {
  if (node.type === "text") {
    const line = cleanLine(node.text ?? "");
    return line ? [line] : [];
  }
  if (isTextContainer(node)) return inlineLines(node);
  const leaf = leafText(node);
  if (leaf) return [leaf];
  return (node.content ?? []).flatMap(blockLines);
}

function tableRows(table: JSONContent): string[] {
  const rows: string[] = [];
  const visit = (node: JSONContent) => {
    if (ROW_TYPES.has(node.type ?? "")) {
      // A merged cell is one node with colspan/rowspan, so its value appears once.
      const cells = (node.content ?? [])
        .filter((cell) => CELL_TYPES.has(cell.type ?? ""))
        .map((cell) => blockLines(cell).join(" "));
      if (cells.some(Boolean)) rows.push(cells.join(TABLE_CELL_SEPARATOR));
      return;
    }
    (node.content ?? []).forEach(visit);
  };
  visit(table);
  return rows;
}

export function countWords(text: string): number {
  return text.normalize("NFC").match(WORD_PATTERN)?.length ?? 0;
}

/**
 * Extract search/RAG text from a TipTap JSON document. Pure and DOM-free: runs in kb-collab
 * when a document is stored and in batch re-index scripts. Unknown node types are walked
 * generically, so newer blocks still contribute their text.
 */
export function extractContent(doc: JSONContent | null | undefined): ExtractedContent {
  const body: string[] = [];
  const headingLines: string[] = [];
  const tables: string[] = [];
  const headings: ExtractedHeading[] = [];

  const visit = (node: JSONContent) => {
    const type = node.type ?? "";

    if (TABLE_TYPES.has(type)) {
      const rows = tableRows(node);
      if (rows.length) tables.push(rows.join("\n"));
      return;
    }

    if (type === "heading") {
      const text = inlineLines(node).join(" ");
      if (text) {
        headingLines.push(text);
        const id = node.attrs?.id;
        const level = Number(node.attrs?.level);
        headings.push({
          id: typeof id === "string" && id ? id : null,
          level: Number.isFinite(level) && level > 0 ? level : 1,
          text,
        });
      }
      return;
    }

    if (type === "text" || isTextContainer(node)) {
      body.push(...blockLines(node));
      return;
    }

    const leaf = leafText(node);
    if (leaf) {
      body.push(leaf);
      return;
    }

    (node.content ?? []).forEach(visit);
  };

  if (doc) visit(doc);

  const contentText = body.join("\n");
  const headingsText = headingLines.join("\n");
  const tableText = tables.join("\n\n");

  return {
    contentText,
    headingsText,
    tableText,
    wordCount: countWords(contentText) + countWords(headingsText) + countWords(tableText),
    headings,
  };
}
