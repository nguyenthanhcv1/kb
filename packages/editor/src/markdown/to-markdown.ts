import type { JSONContent } from "@tiptap/core";

import type { CalloutVariant } from "../extensions/callout";

/**
 * TipTap JSON of the shared editor schema → GitHub-flavoured Markdown (MCP connector, AI tools).
 *
 * Everything an AI assistant needs to read and rewrite a page is kept: headings, lists, task
 * lists, quotes, code blocks, images, links, bold/italic/strike/underline/code, tables and
 * callouts (as GitHub alerts `> [!NOTE]`). Lossy on purpose where Markdown has no syntax: merged
 * cells, cell colours and column widths. Edits that leave such a block alone keep it intact
 * (see `mergeBlockIds` in ./blocks.ts).
 */

/** GitHub alert keyword of each callout variant (parsed back by `markdownToDoc`). */
export const CALLOUT_ALERTS: Record<CalloutVariant, string> = {
  info: "NOTE",
  success: "TIP",
  warning: "WARNING",
  danger: "CAUTION",
};

type Mark = NonNullable<JSONContent["marks"]>[number];

/** Outermost first: links wrap emphasis, emphasis wraps code. */
const MARK_ORDER = ["link", "bold", "italic", "strike", "underline"] as const;

/** Escapes characters that would otherwise start Markdown syntax inside text. */
function escapeText(text: string): string {
  return text.replace(/[\\`*_[\]<>~|]/g, "\\$&");
}

/** Escapes what only matters at the start of a block line (`# x`, `- x`, `1. x`, `> x`). */
function escapeLineStart(line: string): string {
  return line
    .replace(/^(\s*)([#>+-])(?=\s|$)/, "$1\\$2")
    .replace(/^(\s*)(\d+)([.)])(?=\s|$)/, "$1$2\\$3");
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") || /^\s.*\S|\S.*\s$/.test(text) ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function sameMark(a: Mark, b: Mark): boolean {
  if (a.type !== b.type) return false;
  if (a.type !== "link") return true;
  return a.attrs?.href === b.attrs?.href && a.attrs?.title === b.attrs?.title;
}

function linkDestination(href: unknown): string {
  const value = typeof href === "string" ? href : "";
  return /[\s()<>]/.test(value) ? `<${value.replace(/[<>]/g, encodeURIComponent)}>` : value;
}

function titlePart(title: unknown): string {
  return typeof title === "string" && title ? ` "${title.replace(/"/g, '\\"')}"` : "";
}

function wrap(inner: string, mark: Mark): string {
  // Delimiters must touch non-space characters: move surrounding spaces outside.
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  const [, lead, core, trail] = match;
  if (!core) return inner;
  let wrapped: string;
  switch (mark.type) {
    case "link":
      wrapped = `[${core}](${linkDestination(mark.attrs?.href)}${titlePart(mark.attrs?.title)})`;
      break;
    case "bold":
      wrapped = `**${core}**`;
      break;
    case "italic":
      wrapped = `*${core}*`;
      break;
    case "strike":
      wrapped = `~~${core}~~`;
      break;
    case "underline":
      wrapped = `<u>${core}</u>`;
      break;
    default:
      wrapped = core;
  }
  return `${lead}${wrapped}${trail}`;
}

interface InlineOptions {
  /** Inside a table cell: hard breaks become `<br>`, pipes are already escaped. */
  inTable?: boolean;
}

function renderInlineNodes(nodes: JSONContent[], options: InlineOptions): string {
  let out = "";
  let index = 0;
  while (index < nodes.length) {
    const node = nodes[index]!;
    const marks = (node.marks ?? []).filter((mark) => mark.type !== "code");
    const outer = MARK_ORDER.map((type) => marks.find((mark) => mark.type === type)).find(Boolean);
    if (!outer) {
      out += renderLeaf(node, options);
      index += 1;
      continue;
    }
    // Group the run of following nodes that share this mark, render it without the mark, wrap.
    const group: JSONContent[] = [];
    while (index < nodes.length) {
      const candidate = nodes[index]!;
      const shared = (candidate.marks ?? []).find((mark) => sameMark(mark, outer));
      if (!shared) break;
      group.push({
        ...candidate,
        marks: (candidate.marks ?? []).filter((mark) => !sameMark(mark, outer)),
      });
      index += 1;
    }
    out += wrap(renderInlineNodes(group, options), outer);
  }
  return out;
}

function renderLeaf(node: JSONContent, options: InlineOptions): string {
  if (node.type === "hardBreak") return options.inTable ? "<br>" : "\\\n";
  if (node.type !== "text") return "";
  const text = node.text ?? "";
  if ((node.marks ?? []).some((mark) => mark.type === "code")) return codeSpan(text);
  const escaped = escapeText(text);
  return options.inTable ? escaped.replace(/\n/g, "<br>") : escaped;
}

function inline(node: JSONContent, options: InlineOptions = {}): string {
  const text = renderInlineNodes(node.content ?? [], options);
  return options.inTable ? text : text.split("\n").map(escapeLineStart).join("\n");
}

function indent(text: string, prefix: string, firstPrefix = prefix): string {
  return text
    .split("\n")
    .map((line, i) => (i === 0 ? firstPrefix : line ? prefix : prefix.trimEnd()) + line)
    .join("\n");
}

const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

/** Tight = every item is one paragraph, optionally followed by nested lists. */
function isTight(list: JSONContent): boolean {
  return (list.content ?? []).every((item) => {
    const [first, ...rest] = item.content ?? [];
    return (
      (!first || first.type === "paragraph") && rest.every((b) => LIST_TYPES.has(b.type ?? ""))
    );
  });
}

function renderList(list: JSONContent): string {
  const items = list.content ?? [];
  const start = typeof list.attrs?.start === "number" ? list.attrs.start : 1;
  const tight = isTight(list);
  const rendered = items.map((item, i) => {
    let marker = "- ";
    if (list.type === "orderedList") marker = `${start + i}. `;
    if (item.type === "taskItem") marker = `- [${item.attrs?.checked ? "x" : " "}] `;
    const body = (item.content ?? []).map(renderBlock).join(tight ? "\n" : "\n\n");
    const continuation = " ".repeat(list.type === "orderedList" ? marker.length : 2);
    return indent(body, continuation, marker);
  });
  return rendered.join(tight ? "\n" : "\n\n");
}

function cellText(cell: JSONContent): string {
  const blocks = cell.content ?? [];
  return blocks
    .map((block) => {
      if (block.type === "paragraph" || block.type === "heading") {
        return inline(block, { inTable: true });
      }
      // Anything richer than text cannot live in a GFM cell: keep its text on one line.
      return renderBlock(block).replace(/\n+/g, "<br>").replace(/\|/g, "\\|");
    })
    .filter((text) => text !== "")
    .join("<br>");
}

function renderTable(table: JSONContent): string {
  const rows = (table.content ?? []).map((row) => (row.content ?? []).map(cellText));
  if (rows.length === 0) return "";
  const width = Math.max(1, ...rows.map((row) => row.length));
  const pad = (row: string[]) => [...row, ...Array<string>(width - row.length).fill("")];
  const line = (row: string[]) => `| ${pad(row).join(" | ")} |`;
  const [header, ...body] = rows;
  return [line(header!), line(Array<string>(width).fill("---")), ...body.map(line)].join("\n");
}

function renderCodeBlock(node: JSONContent): string {
  const code = (node.content ?? []).map((child) => child.text ?? "").join("");
  const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
  return `${fence}${language}\n${code}\n${fence}`;
}

function renderBlock(node: JSONContent): string {
  switch (node.type) {
    case "paragraph":
      return inline(node);
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
      return `${"#".repeat(level)} ${inline(node).replace(/\\\n/g, " ")}`;
    }
    case "blockquote":
      return indent(renderBlocks(node.content ?? []), "> ");
    case "callout": {
      const variant = (node.attrs?.variant as CalloutVariant) ?? "info";
      const body = renderBlocks(node.content ?? []);
      return indent(`[!${CALLOUT_ALERTS[variant] ?? "NOTE"}]\n${body}`, "> ");
    }
    case "bulletList":
    case "orderedList":
    case "taskList":
      return renderList(node);
    case "codeBlock":
      return renderCodeBlock(node);
    case "horizontalRule":
      return "---";
    case "image": {
      const alt = typeof node.attrs?.alt === "string" ? escapeText(node.attrs.alt) : "";
      return `![${alt}](${linkDestination(node.attrs?.src)}${titlePart(node.attrs?.title)})`;
    }
    case "table":
      return renderTable(node);
    default:
      return node.content ? renderBlocks(node.content) : "";
  }
}

function renderBlocks(blocks: JSONContent[]): string {
  return blocks.map(renderBlock).join("\n\n");
}

/** Markdown of one block node (paragraph, list, table, …). */
export function blockToMarkdown(node: JSONContent): string {
  return renderBlock(node);
}

/** Markdown of a whole document (`{ type: "doc", content: [...] }`). */
export function docToMarkdown(doc: JSONContent): string {
  const markdown = renderBlocks(doc.content ?? []);
  return markdown ? `${markdown}\n` : "";
}
