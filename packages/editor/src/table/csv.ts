import type { JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/**
 * Table → CSV export (docs/PLAN.md T4.5). Pure and DOM-free, so it runs in the browser (table
 * menu → download) as well as on the server or in scripts.
 *
 * Output follows RFC 4180: fields are separated by `,`, records by CRLF (configurable), and a
 * field is wrapped in double quotes when it contains `,`, `"`, CR, LF or leading/trailing
 * whitespace; inner double quotes are doubled. Line breaks inside a cell stay `\n` (inside the
 * quotes) whatever `lineEnding` is. There is no line ending after the last record.
 *
 * The document shape is the ProseMirror tables convention: `table` > `tableRow` > (`tableHeader` |
 * `tableCell`) with `colspan` / `rowspan` attrs. Merged cells are expanded into the full grid, so
 * every record has the same number of fields.
 */
export interface TableToCsvOptions {
  /** Prepend a UTF-8 BOM (`\ufeff`) so Excel detects UTF-8 and shows Vietnamese correctly. Default `true`. */
  bom?: boolean;
  /** Record separator. Default `"\r\n"` (RFC 4180). */
  lineEnding?: "\r\n" | "\n";
  /**
   * What the grid positions covered by a merged cell contain:
   * - `"empty"` (default): the value sits in the top-left position, the other covered positions are empty;
   * - `"repeat"`: every covered position repeats the merged cell's value.
   */
  mergedCells?: "repeat" | "empty";
  /**
   * Spreadsheet formula-injection guard (OWASP "CSV injection"). When `true` (default), a value
   * that starts with `=`, `+`, `-`, `@`, TAB or CR is prefixed with `'` so Excel / Sheets / Calc
   * show it as text instead of evaluating it. Plain numbers such as `-12`, `+84`, `-3,5` or `-10%`
   * are left alone because they cannot be formulas. Set `false` for machine-to-machine exports.
   */
  escapeFormulas?: boolean;
}

/** UTF-8 byte order mark, as a JS string (`EF BB BF` once encoded). */
export const CSV_BOM = "\ufeff";

/** MIME type to use for the downloaded Blob. */
export const CSV_MIME_TYPE = "text/csv;charset=utf-8";

const ROW_TYPES = new Set(["tableRow"]);
const CELL_TYPES = new Set(["tableCell", "tableHeader"]);
const LINE_BREAK_TYPES = new Set(["hardBreak"]);
/** Attrs an inline/leaf atom (mention, emoji, image…) may carry as its visible text, by priority. */
const ATOM_TEXT_ATTRS = ["text", "label", "alt"] as const;

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d+(?:[., \u00a0]\d+)*%?$/;
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

function positiveInt(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function atomText(node: JSONContent): string {
  for (const key of ATOM_TEXT_ATTRS) {
    const value = node.attrs?.[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

/** A node whose children are inline content (text, hard breaks, inline atoms). */
function isTextBlock(node: JSONContent): boolean {
  return (node.content ?? []).some(
    (child) => child.type === "text" || LINE_BREAK_TYPES.has(child.type ?? ""),
  );
}

function inlineText(node: JSONContent): string {
  let text = "";
  for (const child of node.content ?? []) {
    if (child.type === "text") text += child.text ?? "";
    else if (LINE_BREAK_TYPES.has(child.type ?? "")) text += "\n";
    else if (child.content?.length) text += inlineText(child);
    else text += atomText(child);
  }
  return text;
}

/** Lines contributed by a block (paragraphs, headings, list items, code blocks, nested blocks). */
function blockLines(node: JSONContent): string[] {
  if (node.type === "text") return [node.text ?? ""];
  if (isTextBlock(node)) return [inlineText(node)];
  if (!node.content?.length) {
    // Empty paragraph → empty line; leaf atoms (image, mention outside a paragraph) → their text.
    return [atomText(node)];
  }
  return node.content.flatMap(blockLines);
}

/** Plain text of a cell: block children joined by `\n`, marks dropped, NFC. */
function cellText(cell: JSONContent): string {
  const lines = (cell.content ?? []).flatMap(blockLines);
  // Drop empty lines at the edges (e.g. a trailing empty paragraph) but keep inner blank lines.
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start]) start++;
  while (end > start && !lines[end - 1]) end--;
  return lines.slice(start, end).join("\n").normalize("NFC");
}

interface GridCell {
  text: string;
  /** `true` for positions covered by a merged cell other than its top-left one. */
  covered: boolean;
}

/**
 * Expand a table into a rectangular grid, resolving colspan/rowspan the same way
 * prosemirror-tables' `TableMap` does (a cell takes the first free column of its row).
 * Rowspans reaching past the last row are clipped.
 */
function buildGrid(table: JSONContent): GridCell[][] {
  const rows = (table.content ?? []).filter((row) => ROW_TYPES.has(row.type ?? ""));
  const grid: (GridCell | undefined)[][] = rows.map(() => []);

  rows.forEach((row, r) => {
    const line = grid[r]!;
    let col = 0;
    for (const cell of row.content ?? []) {
      if (!CELL_TYPES.has(cell.type ?? "")) continue;
      while (line[col]) col++;
      const colspan = positiveInt(cell.attrs?.colspan);
      const rowspan = positiveInt(cell.attrs?.rowspan);
      const text = cellText(cell);
      for (let dr = 0; dr < rowspan && r + dr < rows.length; dr++) {
        const target = grid[r + dr]!;
        for (let dc = 0; dc < colspan; dc++) {
          target[col + dc] ??= { text, covered: dr > 0 || dc > 0 };
        }
      }
      col += colspan;
    }
  });

  const width = Math.max(0, ...grid.map((line) => line.length));
  return grid.map((line) =>
    Array.from({ length: width }, (_, c) => line[c] ?? { text: "", covered: false }),
  );
}

function escapeField(value: string, escapeFormulas: boolean): string {
  let field = value;
  if (escapeFormulas && FORMULA_START.test(field) && !PLAIN_NUMBER.test(field)) {
    field = `'${field}`;
  }
  return NEEDS_QUOTES.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

/**
 * CSV for a table given as TipTap JSON (the `table` node itself, e.g. from `editor.getJSON()`).
 * A table without rows or cells yields an empty body (just the BOM when `bom` is on).
 */
export function tableJsonToCsv(table: JSONContent, options: TableToCsvOptions = {}): string {
  const { bom = true, lineEnding = "\r\n", mergedCells = "empty", escapeFormulas = true } = options;
  const records = buildGrid(table).map((line) =>
    line
      .map((cell) =>
        escapeField(cell.covered && mergedCells === "empty" ? "" : cell.text, escapeFormulas),
      )
      .join(","),
  );
  const body = records.every((record) => record === "") ? "" : records.join(lineEnding);
  return (bom ? CSV_BOM : "") + body;
}

/** CSV for a ProseMirror `table` node (e.g. found via `findParentNode` in the table menu). */
export function tableNodeToCsv(table: ProseMirrorNode, options?: TableToCsvOptions): string {
  return tableJsonToCsv(table.toJSON() as JSONContent, options);
}

const FILE_NAME_TIME_ZONE = "Asia/Ho_Chi_Minh";
const FILE_NAME_FALLBACK = "table";
const FILE_NAME_MAX_LENGTH = 100;
/** Characters not allowed in file names on Windows/macOS/Linux, plus path separators. */
const UNSAFE_FILE_CHARS = /[\\/:*?"<>|]/g;
/** Control and format characters (incl. zero-width / bidi marks) and line/paragraph separators. */
const INVISIBLE_CHARS = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

function formatDate(date: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FILE_NAME_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Safe download name for a CSV export, e.g. `csvFileName("Báo cáo Q1/2026", date)` →
 * `"Bao cao Q1-2026 2026-09-26.csv"`. Drops Vietnamese diacritics (docs/PLAN.md T4.5: some
 * mail clients, zip tools and older Windows setups mangle non-ASCII names; case is kept), replaces
 * path separators and characters Windows forbids with `-`, removes control/invisible characters,
 * collapses whitespace, strips leading dots (no hidden files / `..`) and trailing dots/spaces,
 * avoids Windows reserved names and caps the base name at 100 characters. An empty title
 * falls back to `table`. The optional date is appended as `YYYY-MM-DD` in Asia/Ho_Chi_Minh.
 */
/** `Đặc biệt` → `Dac biet`: NFD, drop combining marks, `đ/Đ` → `d/D`; keeps case (unlike normalizeVi). */
function stripDiacritics(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFC");
}

export function csvFileName(title: string | undefined, date?: Date): string {
  let base = stripDiacritics(title ?? "")
    .replace(INVISIBLE_CHARS, " ")
    .replace(UNSAFE_FILE_CHARS, "-")
    .replace(/\s+/g, " ")
    .replace(/-{2,}/g, "-")
    .replace(/^[\s.-]+/, "")
    .replace(/[\s.]+$/, "")
    .replace(/\.csv$/i, "")
    .replace(/[\s.]+$/, "");
  const chars = Array.from(base);
  if (chars.length > FILE_NAME_MAX_LENGTH) {
    base = chars
      .slice(0, FILE_NAME_MAX_LENGTH)
      .join("")
      .replace(/[\s.-]+$/, "");
  }
  if (!base) base = FILE_NAME_FALLBACK;
  if (WINDOWS_RESERVED.test(base)) base = `${base}_`;
  const suffix = date && !Number.isNaN(date.getTime()) ? ` ${formatDate(date)}` : "";
  return `${base}${suffix}.csv`;
}
