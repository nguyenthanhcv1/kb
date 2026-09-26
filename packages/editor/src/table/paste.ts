/**
 * Spreadsheet clipboard → editor table (T4.4a, docs/PLAN.md T4.4).
 *
 * Pure, UI-free parsing of what Excel (Windows/Mac), Google Sheets, LibreOffice Calc or any
 * TSV source puts on the clipboard, into an intermediate grid model (`PastedTable`) and then
 * into TipTap/ProseMirror table JSON or nodes. The editor paste handler (T4.4b) and the cell
 * background attribute (T4.2) plug in through the options below; nothing here touches an
 * editor view.
 *
 * - HTML: the first `<table>`, `colspan`/`rowspan`, `<th>`, column widths (`<col>`,
 *   `<colgroup>`, Excel's hidden width row), cell background (inline style → `<style>` class
 *   rules such as Excel's `.xl65 {background:#FFFF00}` → `bgcolor`). Every other style,
 *   Excel `mso-*` markup, conditional comments and `<google-sheets-html-origin>` wrappers are
 *   dropped. Line breaks inside a cell (`<br>`, block elements) are kept.
 * - Plain text: TSV as Excel/Sheets write it — fields containing tabs, newlines or quotes are
 *   wrapped in `"…"` with `""` escapes; CRLF, LF and CR row separators.
 * - All text is normalised to Unicode NFC (Vietnamese often arrives decomposed, PLAN §6).
 *
 * Works in the browser (global `DOMParser`) and in Node (pass `parseHtml`, e.g. happy-dom).
 */
import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode, NodeType, Schema } from "@tiptap/pm/model";

// ---------------------------------------------------------------------------------------------
// Grid model
// ---------------------------------------------------------------------------------------------

/** Where the clipboard data came from (best guess from markup). */
export type PasteSource = "excel" | "google-sheets" | "libreoffice" | "html" | "tsv";

/** One cell of a pasted table, positioned on the grid by its top-left corner. */
export interface PastedCell {
  /** Row of the cell's top-left corner (0-based). */
  row: number;
  /** Column of the cell's top-left corner (0-based). */
  col: number;
  rowspan: number;
  colspan: number;
  /** Plain text, NFC-normalised; `\n` separates lines inside the cell. `""` = empty cell. */
  text: string;
  /** `<th>` in the source (spreadsheets never emit it; `ToTableOptions.headerRow` forces it). */
  header: boolean;
  /**
   * Fill colour as lowercase `#rrggbb`, or `null` when none. White and transparent fills are
   * treated as "no fill" so pasted tables stay readable in dark mode.
   */
  background: string | null;
}

/** A pasted table: rectangular, every grid slot covered by exactly one cell. */
export interface PastedTable {
  source: PasteSource;
  rowCount: number;
  colCount: number;
  /** Cells grouped by the row of their top-left corner, each row sorted by column. */
  rows: PastedCell[][];
  /** Column widths in CSS pixels (`null` = unknown), length `colCount`. */
  columnWidths: (number | null)[];
}

/** Parses an HTML string into something `querySelector` works on. */
export type HtmlParser = (html: string) => ParentNode;

export interface ParseClipboardOptions {
  /**
   * HTML parser. Defaults to the global `DOMParser` (browsers). Required in Node — e.g.
   * `(html) => new (new Window()).DOMParser().parseFromString(html, "text/html")` with
   * happy-dom.
   */
  parseHtml?: HtmlParser;
}

/** Upper bounds that keep a malformed `colspan`/`rowspan` from exploding the grid. */
const MAX_COLSPAN = 1000;
const MAX_ROWSPAN = 65534;

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/**
 * Parses clipboard data into a table, preferring `text/html` and falling back to TSV in
 * `text/plain`. Returns `null` when the clipboard holds no table (no `<table>` and no tab in
 * the text), so the caller can fall back to the normal paste.
 */
export function parseClipboardTable(
  data: { html?: string | null; text?: string | null },
  options: ParseClipboardOptions = {},
): PastedTable | null {
  if (data.html && /<table[\s>]/i.test(data.html)) {
    const table = parseHtmlTable(data.html, options);
    if (table) return table;
  }
  if (data.text && data.text.includes("\t")) return parseTsv(data.text);
  return null;
}

// ---------------------------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------------------------

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** Parses the first `<table>` of an HTML clipboard payload. `null` when there is none. */
export function parseHtmlTable(
  html: string,
  options: ParseClipboardOptions = {},
): PastedTable | null {
  const root = resolveParser(options.parseHtml)(stripCfHtmlHeader(html));
  const table = root.querySelector("table");
  if (!table) return null;

  const source = detectSource(html);
  const classBackgrounds = collectClassBackgrounds(root);

  const trs: Element[] = [];
  const widthRows: Element[] = [];
  for (const tr of tableRows(table)) {
    if (isLayoutRow(tr)) widthRows.push(tr);
    else trs.push(tr);
  }
  if (!trs.length) return null;

  const rowCount = trs.length;
  const occupied: Uint8Array[] = trs.map(() => new Uint8Array(0));
  const isOccupied = (r: number, c: number) => (occupied[r]?.[c] ?? 0) === 1;
  const occupy = (r: number, c: number) => {
    let line = occupied[r]!;
    if (c >= line.length) {
      const grown = new Uint8Array(Math.max(c + 1, line.length * 2, 8));
      grown.set(line);
      occupied[r] = line = grown;
    }
    line[c] = 1;
  };

  const rows: PastedCell[][] = trs.map(() => []);
  let colCount = 0;
  trs.forEach((tr, r) => {
    let c = 0;
    for (const td of childElements(tr, CELL_TAGS)) {
      while (isOccupied(r, c)) c++;
      const colspan = clampSpan(td.getAttribute("colspan"), MAX_COLSPAN, 1);
      const rawRowspan = clampSpan(td.getAttribute("rowspan"), MAX_ROWSPAN, 0);
      // rowspan="0" spans to the end of the table; never span past the last row.
      const rowspan = Math.min(rawRowspan === 0 ? rowCount - r : rawRowspan, rowCount - r);
      for (let dr = 0; dr < rowspan; dr++) {
        for (let dc = 0; dc < colspan; dc++) occupy(r + dr, c + dc);
      }
      rows[r]!.push({
        row: r,
        col: c,
        rowspan,
        colspan,
        text: cellText(td),
        header: td.tagName.toLowerCase() === "th",
        background: cellBackground(td, classBackgrounds),
      });
      c += colspan;
      colCount = Math.max(colCount, c);
    }
  });
  if (colCount === 0) return null;

  padRows(rows, colCount, isOccupied);

  return {
    source,
    rowCount,
    colCount,
    rows,
    columnWidths: columnWidths(table, widthRows, colCount),
  };
}

function resolveParser(parseHtml: HtmlParser | undefined): HtmlParser {
  if (parseHtml) return parseHtml;
  const Parser = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  if (!Parser) {
    throw new Error("KB_PASTE_NO_HTML_PARSER: pass options.parseHtml outside the browser");
  }
  const parser = new Parser();
  return (html) => parser.parseFromString(html, "text/html");
}

/** Raw Windows CF_HTML starts with `Version:0.9\r\nStartHTML:…` before the markup. */
function stripCfHtmlHeader(html: string): string {
  if (!/^\s*Version:\d/.test(html)) return html;
  const start = html.indexOf("<");
  return start === -1 ? html : html.slice(start);
}

function detectSource(html: string): PasteSource {
  if (/<google-sheets-html-origin|data-sheets-(?:root|value)/i.test(html)) return "google-sheets";
  if (
    /urn:schemas-microsoft-com:office:excel|content=["']?Excel\.Sheet|Microsoft Excel/i.test(html)
  ) {
    return "excel";
  }
  if (/content=["']?LibreOffice|content=["']?OpenOffice/i.test(html)) return "libreoffice";
  return "html";
}

const SECTION_TAGS = new Set(["thead", "tbody", "tfoot"]);
const CELL_TAGS = new Set(["td", "th"]);

function childElements(parent: Element, tags: Set<string>): Element[] {
  const out: Element[] = [];
  for (const child of Array.from(parent.children)) {
    if (tags.has(child.tagName.toLowerCase())) out.push(child);
  }
  return out;
}

/** Direct rows of a table (through `thead`/`tbody`/`tfoot`), never rows of nested tables. */
function tableRows(table: Element): Element[] {
  const out: Element[] = [];
  for (const child of Array.from(table.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === "tr") out.push(child);
    else if (SECTION_TAGS.has(tag)) out.push(...childElements(child, new Set(["tr"])));
  }
  return out;
}

/**
 * Excel appends an invisible `<tr height=0 style='display:none'>` of empty cells (inside
 * `<![if supportMisalignedColumns]>`) that only carries column widths. Hidden rows with
 * content are kept, matching what Excel puts in `text/plain`.
 */
function isLayoutRow(tr: Element): boolean {
  if (!/display\s*:\s*none/i.test(tr.getAttribute("style") ?? "")) return false;
  return childElements(tr, CELL_TAGS).every((td) => (td.textContent ?? "").trim() === "");
}

function clampSpan(value: string | null, max: number, zero: 0 | 1): number {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(n)) return 1;
  if (n <= 0) return zero === 0 && n === 0 ? 0 : 1;
  return Math.min(n, max);
}

/** Fills uncovered grid slots (ragged rows) with empty cells so the table is rectangular. */
function padRows(
  rows: PastedCell[][],
  colCount: number,
  isOccupied: (r: number, c: number) => boolean,
): void {
  rows.forEach((cells, r) => {
    let added = false;
    for (let c = 0; c < colCount; c++) {
      if (isOccupied(r, c)) continue;
      cells.push(emptyCell(r, c));
      added = true;
    }
    if (added) cells.sort((a, b) => a.col - b.col);
  });
}

function emptyCell(row: number, col: number): PastedCell {
  return { row, col, rowspan: 1, colspan: 1, text: "", header: false, background: null };
}

// --- cell text --------------------------------------------------------------------------------

const SKIP_TAGS = new Set(["style", "script", "template", "head", "title", "xml"]);
const BLOCK_TAGS = new Set([
  "p",
  "div",
  "li",
  "ul",
  "ol",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "blockquote",
  "table",
  "tr",
]);

/**
 * Visible text of a cell: HTML whitespace collapsed (Excel hard-wraps long source lines),
 * `&nbsp;` (Excel `mso-spacerun`) turned into spaces, `<br>` and block boundaries kept as
 * `\n`, NFC-normalised.
 */
function cellText(td: Element): string {
  const lines: string[] = [];
  let current = "";
  const breakLine = () => {
    lines.push(current);
    current = "";
  };
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) {
        current += child.nodeValue ?? "";
      } else if (child.nodeType === ELEMENT_NODE) {
        const tag = (child as Element).tagName.toLowerCase();
        if (tag === "br") {
          breakLine();
        } else if (SKIP_TAGS.has(tag)) {
          continue;
        } else if (BLOCK_TAGS.has(tag)) {
          if (current.trim()) breakLine();
          walk(child);
          if (current.trim()) breakLine();
          current = "";
        } else {
          walk(child);
        }
      }
    }
  };
  walk(td);
  lines.push(current);

  const cleaned = lines.map((line) =>
    line
      .replace(/[ \t\n\r\f]+/g, " ")
      .replace(/\u00a0/g, " ")
      .trim(),
  );
  while (cleaned.length && cleaned[cleaned.length - 1] === "") cleaned.pop();
  while (cleaned.length && cleaned[0] === "") cleaned.shift();
  return cleaned.join("\n").normalize("NFC");
}

// --- backgrounds ------------------------------------------------------------------------------

/** Class name → background from `<style>` rules like `.xl65 {background:#FFFF00;}`. */
function collectClassBackgrounds(root: ParentNode): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const style of Array.from(root.querySelectorAll("style"))) {
    const css = (style.textContent ?? "").replace(/<!--|-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const background = backgroundFromDeclarations(rule[2]!);
      if (background === undefined) continue;
      for (const selector of rule[1]!.split(",")) {
        const name = /^\s*(?:td|th)?\.([\w-]+)\s*$/i.exec(selector)?.[1];
        if (name) map.set(name, background);
      }
    }
  }
  return map;
}

/** Inline style wins over class rules, which win over the legacy `bgcolor` attribute. */
function cellBackground(td: Element, classBackgrounds: Map<string, string | null>): string | null {
  const inline = backgroundFromDeclarations(td.getAttribute("style") ?? "");
  if (inline !== undefined) return inline;
  let fromClass: string | null | undefined;
  for (const name of (td.getAttribute("class") ?? "").split(/\s+/)) {
    if (name && classBackgrounds.has(name)) fromClass = classBackgrounds.get(name);
  }
  if (fromClass !== undefined) return fromClass;
  const bgcolor = td.getAttribute("bgcolor");
  return bgcolor ? normalizeColor(bgcolor) : null;
}

const COLOR_TOKEN = /rgba?\([^)]*\)|#[0-9a-f]{3,8}\b|[a-z]+/gi;

/**
 * Background colour from a CSS declaration list. `undefined` = no background declared,
 * `null` = declared but none/white/unknown.
 */
function backgroundFromDeclarations(declarations: string): string | null | undefined {
  let result: string | null | undefined;
  for (const declaration of declarations.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1);
    if (property === "background-color") {
      result = normalizeColor(value);
    } else if (property === "background") {
      result = null;
      for (const token of value.matchAll(COLOR_TOKEN)) {
        const color = normalizeColor(token[0]);
        if (color) {
          result = color;
          break;
        }
      }
    }
  }
  return result;
}

/** Colours Excel and LibreOffice write by name (CSS level 1 + orange). */
const NAMED_COLORS: Record<string, string> = {
  aqua: "#00ffff",
  black: "#000000",
  blue: "#0000ff",
  fuchsia: "#ff00ff",
  gray: "#808080",
  green: "#008000",
  grey: "#808080",
  lime: "#00ff00",
  maroon: "#800000",
  navy: "#000080",
  olive: "#808000",
  orange: "#ffa500",
  purple: "#800080",
  red: "#ff0000",
  silver: "#c0c0c0",
  teal: "#008080",
  white: "#ffffff",
  yellow: "#ffff00",
};

const NO_FILL = new Set(["#ffffff"]);

/** Any CSS colour we understand → lowercase `#rrggbb`; white/transparent/unknown → `null`. */
export function normalizeColor(value: string): string | null {
  const v = value
    .trim()
    .toLowerCase()
    .replace(/\s*!important$/, "");
  let hex: string | null = null;
  let m: RegExpExecArray | null;
  if ((m = /^#([0-9a-f]{3,4})$/.exec(v))) {
    const [r, g, b, a] = m[1]!.split("");
    if (a === "0") return null;
    hex = `#${r}${r}${g}${g}${b}${b}`;
  } else if ((m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v))) {
    if (m[2] === "00") return null;
    hex = `#${m[1]}`;
  } else if ((m = /^rgba?\(([^)]*)\)$/.exec(v))) {
    const parts = m[1]!.split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const alpha = parts[3];
    if (alpha !== undefined && Number.parseFloat(alpha) === 0) return null;
    const channels = parts.slice(0, 3).map((p) => {
      const n = p.endsWith("%") ? (Number.parseFloat(p) * 255) / 100 : Number.parseFloat(p);
      return Math.max(0, Math.min(255, Math.round(n)));
    });
    if (channels.some((n) => Number.isNaN(n))) return null;
    hex = `#${channels.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  } else {
    hex = NAMED_COLORS[v] ?? null;
  }
  return hex && !NO_FILL.has(hex) ? hex : null;
}

// --- column widths ----------------------------------------------------------------------------

function columnWidths(table: Element, widthRows: Element[], colCount: number): (number | null)[] {
  const widths: (number | null)[] = [];
  const push = (el: Element) => {
    const span = clampSpan(el.getAttribute("span"), MAX_COLSPAN, 1);
    const width = lengthToPx(el);
    for (let i = 0; i < span; i++) widths.push(width);
  };
  for (const child of Array.from(table.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === "col") push(child);
    else if (tag === "colgroup") {
      const cols = childElements(child, new Set(["col"]));
      if (cols.length) cols.forEach(push);
      else push(child);
    }
  }
  // Excel's hidden width row, for parsers that drop `<col>` directly under `<table>`.
  if (!widths.some((w) => w !== null) && widthRows[0]) {
    widths.length = 0;
    for (const td of childElements(widthRows[0], CELL_TAGS)) push(td);
  }
  const out: (number | null)[] = [];
  for (let c = 0; c < colCount; c++) out.push(widths[c] ?? null);
  return out;
}

/** `width="64"` (pixels) or `style="width:48pt"` → CSS pixels. */
function lengthToPx(el: Element): number | null {
  const attr = el.getAttribute("width");
  if (attr && /^\s*\d+(?:\.\d+)?\s*(?:px)?\s*$/i.test(attr)) {
    return positive(Math.round(Number.parseFloat(attr)));
  }
  const m = /(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)\s*(px|pt)?/i.exec(
    el.getAttribute("style") ?? "",
  );
  if (!m) return null;
  const n = Number.parseFloat(m[1]!);
  return positive(Math.round(m[2]?.toLowerCase() === "pt" ? (n * 4) / 3 : n));
}

const positive = (n: number) => (n > 0 ? n : null);

// ---------------------------------------------------------------------------------------------
// TSV
// ---------------------------------------------------------------------------------------------

/**
 * Parses tab-separated text as Excel/Sheets write it. A field that starts with `"` and closes
 * with `"` right before a tab/newline/end is unquoted (`""` → `"`, may contain tabs and
 * newlines); any other quote is literal. Returns `null` for blank text.
 */
export function parseTsv(text: string): PastedTable | null {
  const input = text.replace(/^\uFEFF/, "");
  if (!input.trim()) return null;

  const records: string[][] = [];
  let record: string[] = [];
  const n = input.length;
  let i = 0;
  for (;;) {
    let value: string | null = null;
    if (input.charCodeAt(i) === 34 /* " */) {
      const parts: string[] = [];
      let j = i + 1;
      for (;;) {
        const q = input.indexOf('"', j);
        if (q === -1) break;
        parts.push(input.slice(j, q));
        if (input.charCodeAt(q + 1) === 34) {
          parts.push('"');
          j = q + 2;
          continue;
        }
        const next = input[q + 1];
        if (next === undefined || next === "\t" || next === "\n" || next === "\r") {
          value = parts.join("");
          i = q + 1;
        }
        break;
      }
    }
    if (value === null) {
      let k = i;
      while (k < n) {
        const ch = input.charCodeAt(k);
        if (ch === 9 || ch === 10 || ch === 13) break;
        k++;
      }
      value = input.slice(i, k);
      i = k;
    }
    record.push(value.replace(/\r\n?/g, "\n").normalize("NFC"));

    if (i >= n) {
      records.push(record);
      break;
    }
    const ch = input[i];
    i++;
    if (ch === "\t") continue;
    if (ch === "\r" && input[i] === "\n") i++;
    records.push(record);
    record = [];
    if (i >= n) break;
  }

  const colCount = Math.max(...records.map((r) => r.length));
  const rows = records.map((values, r) => {
    const cells: PastedCell[] = [];
    for (let c = 0; c < colCount; c++) {
      cells.push({ ...emptyCell(r, c), text: values[c] ?? "" });
    }
    return cells;
  });
  return {
    source: "tsv",
    rowCount: rows.length,
    colCount,
    rows,
    columnWidths: Array.from({ length: colCount }, () => null),
  };
}

// ---------------------------------------------------------------------------------------------
// Grid → TipTap JSON / ProseMirror node
// ---------------------------------------------------------------------------------------------

export interface ToTableOptions {
  /** Make every cell of the first row a `tableHeader`. Default: only cells that were `<th>`. */
  headerRow?: boolean;
  /**
   * Cell attribute receiving `PastedCell.background` (T4.2 adds `backgroundColor`).
   * JSON: omitted when unset. Node: auto-detected from the schema (`backgroundColor`, then
   * `background`) — pass `null` to drop colours.
   */
  backgroundAttr?: string | null;
  /**
   * Maps a pasted `#rrggbb` to the stored value, e.g. the nearest palette token of T4.2.
   * Return `null` to drop the colour. Default: keep the hex value.
   */
  mapBackground?: (color: string) => string | null;
  /** Emit `colwidth` from the pasted column widths. Default `true`. */
  columnWidths?: boolean;
  /** Multi-line cells: `hardBreak` inside one paragraph (default) or one paragraph per line. */
  lineBreaks?: "hardBreak" | "paragraphs";
}

/** Node type names of the TipTap table extension (`@tiptap/extension-table`). */
export const TABLE_NODE_NAMES = {
  table: "table",
  row: "tableRow",
  cell: "tableCell",
  header: "tableHeader",
} as const;

/** TipTap JSON for a `table` node — `editor.commands.insertContent(json)` accepts it. */
export function pastedTableToJSON(table: PastedTable, options: ToTableOptions = {}): JSONContent {
  const withWidths = options.columnWidths !== false;
  const rows = table.rows.map((cells) => ({
    type: TABLE_NODE_NAMES.row,
    content: cells.map((cell) => cellToJSON(cell, table, options, withWidths)),
  }));
  return { type: TABLE_NODE_NAMES.table, content: rows };
}

function cellToJSON(
  cell: PastedCell,
  table: PastedTable,
  options: ToTableOptions,
  withWidths: boolean,
): JSONContent {
  const attrs: Record<string, unknown> = { colspan: cell.colspan, rowspan: cell.rowspan };
  if (withWidths) {
    const widths = table.columnWidths.slice(cell.col, cell.col + cell.colspan);
    attrs.colwidth = widths.every((w): w is number => typeof w === "number") ? widths : null;
  }
  if (options.backgroundAttr && cell.background) {
    const value = options.mapBackground ? options.mapBackground(cell.background) : cell.background;
    if (value) attrs[options.backgroundAttr] = value;
  }
  const header = cell.header || (options.headerRow === true && cell.row === 0);
  return {
    type: header ? TABLE_NODE_NAMES.header : TABLE_NODE_NAMES.cell,
    attrs,
    content: cellContent(cell.text, options.lineBreaks ?? "hardBreak"),
  };
}

function cellContent(text: string, lineBreaks: "hardBreak" | "paragraphs"): JSONContent[] {
  const lines = text ? text.split("\n") : [];
  const textNode = (line: string): JSONContent[] => (line ? [{ type: "text", text: line }] : []);
  if (lineBreaks === "paragraphs") {
    if (!lines.length) return [{ type: "paragraph" }];
    return lines.map((line) => {
      const content = textNode(line);
      return content.length ? { type: "paragraph", content } : { type: "paragraph" };
    });
  }
  const content: JSONContent[] = [];
  lines.forEach((line, i) => {
    if (i > 0) content.push({ type: "hardBreak" });
    content.push(...textNode(line));
  });
  return [content.length ? { type: "paragraph", content } : { type: "paragraph" }];
}

/**
 * ProseMirror `table` node for `schema`, or `null` when the schema has no table nodes (before
 * T4.1). Attributes the schema does not define (e.g. a background before T4.2, `colwidth`)
 * are left out; multi-line cells use paragraphs when the schema has no `hardBreak`.
 */
export function pastedTableToNode(
  table: PastedTable,
  schema: Schema,
  options: ToTableOptions = {},
): PMNode | null {
  const cellType = schema.nodes[TABLE_NODE_NAMES.cell];
  if (!schema.nodes[TABLE_NODE_NAMES.table] || !schema.nodes[TABLE_NODE_NAMES.row] || !cellType) {
    return null;
  }
  const headerType = schema.nodes[TABLE_NODE_NAMES.header];
  const cellAttrs = attrNames(cellType);
  const backgroundAttr =
    options.backgroundAttr === undefined
      ? (["backgroundColor", "background"].find((name) => cellAttrs.has(name)) ?? null)
      : options.backgroundAttr && cellAttrs.has(options.backgroundAttr)
        ? options.backgroundAttr
        : null;

  const json = pastedTableToJSON(table, {
    ...options,
    backgroundAttr,
    columnWidths: options.columnWidths !== false && cellAttrs.has("colwidth"),
    lineBreaks: schema.nodes.hardBreak ? (options.lineBreaks ?? "hardBreak") : "paragraphs",
  });
  for (const row of json.content ?? []) {
    for (const cell of row.content ?? []) {
      if (cell.type === TABLE_NODE_NAMES.header && !headerType) cell.type = TABLE_NODE_NAMES.cell;
      const allowed = attrNames(schema.nodes[cell.type!]!);
      cell.attrs = Object.fromEntries(
        Object.entries(cell.attrs ?? {}).filter(([name]) => allowed.has(name)),
      );
    }
  }
  return schema.nodeFromJSON(json);
}

function attrNames(type: NodeType): Set<string> {
  return new Set(Object.keys(type.spec.attrs ?? {}));
}

// ---------------------------------------------------------------------------------------------
// Pasting into an existing table
// ---------------------------------------------------------------------------------------------

/** Minimal shape of an existing table (e.g. from prosemirror-tables `TableMap`). */
export interface TableShape {
  rowCount: number;
  colCount: number;
  /** Cells by top-left corner. Only merged cells matter; 1×1 cells may be omitted. */
  cells?: readonly { row: number; col: number; rowspan: number; colspan: number }[];
}

export interface PastePlan {
  /** Rows / columns to append at the bottom / right before writing. */
  addRows: number;
  addCols: number;
  /** Table size after expansion. */
  rowCount: number;
  colCount: number;
  /** Overwritten region, `bottom`/`right` exclusive, in (expanded) table coordinates. */
  region: { top: number; left: number; bottom: number; right: number };
  /** Existing merged cells intersecting the region: split them before writing. */
  cellsToSplit: { row: number; col: number; rowspan: number; colspan: number }[];
  /** Pasted cells at their absolute position (spans are to be recreated by merging). */
  writes: (PastedCell & { targetRow: number; targetCol: number })[];
}

/**
 * How a pasted grid overwrites an existing table starting at the cell `anchor` (the selected
 * cell, or the top-left of a cell selection): the region `[anchor, anchor + pasted size)` is
 * overwritten, missing rows/columns are appended, and existing merged cells touching the
 * region are listed for splitting first. Pure — the editor applies it (T4.4b).
 */
export function planTablePaste(
  table: TableShape,
  anchor: { row: number; col: number },
  pasted: PastedTable,
): PastePlan {
  const top = Math.max(0, Math.min(anchor.row, table.rowCount));
  const left = Math.max(0, Math.min(anchor.col, table.colCount));
  const bottom = top + pasted.rowCount;
  const right = left + pasted.colCount;
  const rowCount = Math.max(table.rowCount, bottom);
  const colCount = Math.max(table.colCount, right);

  const cellsToSplit = (table.cells ?? [])
    .filter(
      (cell) =>
        (cell.rowspan > 1 || cell.colspan > 1) &&
        cell.row < bottom &&
        cell.row + cell.rowspan > top &&
        cell.col < right &&
        cell.col + cell.colspan > left,
    )
    .map(({ row, col, rowspan, colspan }) => ({ row, col, rowspan, colspan }));

  const writes = pasted.rows.flatMap((cells) =>
    cells.map((cell) => ({ ...cell, targetRow: top + cell.row, targetCol: left + cell.col })),
  );

  return {
    addRows: rowCount - table.rowCount,
    addCols: colCount - table.colCount,
    rowCount,
    colCount,
    region: { top, left, bottom, right },
    cellsToSplit,
    writes,
  };
}
