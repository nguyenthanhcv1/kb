import type { JSONContent } from "@tiptap/core";
import { Lexer, type Token, type Tokens } from "marked";

import { CALLOUT_VARIANTS, type CalloutVariant } from "../extensions/callout";
import { HEADING_LEVELS } from "../extensions/index";
import { CALLOUT_ALERTS } from "./to-markdown";

/**
 * GitHub-flavoured Markdown → TipTap JSON of the shared editor schema (MCP connector, AI tools).
 *
 * The inverse of `docToMarkdown`: GitHub alerts (`> [!NOTE]`) become callouts, `<u>…</u>`
 * underline, `<br>` hard breaks; headings deeper than the editor allows are clamped, inline
 * images become image blocks (the schema has no inline images). Raw HTML other than those tags is
 * kept as text. Block IDs are not assigned here (`assignBlockIds` in ./blocks.ts).
 */

type Mark = NonNullable<JSONContent["marks"]>[number];

const ALERT_VARIANTS: Record<string, CalloutVariant> = {
  ...Object.fromEntries(
    CALLOUT_VARIANTS.map((variant) => [CALLOUT_ALERTS[variant], variant] as const),
  ),
  INFO: "info",
  IMPORTANT: "warning",
  SUCCESS: "success",
  DANGER: "danger",
};

const ALERT_PATTERN = /^\[!([A-Za-z]+)\][ \t]*(?:\n|$)/;
const MAX_HEADING = HEADING_LEVELS[HEADING_LEVELS.length - 1];

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function textNode(text: string, marks: Mark[]): JSONContent {
  return marks.length ? { type: "text", text, marks: [...marks] } : { type: "text", text };
}

/** Inline content of a block; images are lifted out by the caller (`splitImages`). */
function inlineContent(tokens: Token[] | undefined, marks: Mark[] = []): JSONContent[] {
  const out: JSONContent[] = [];
  let html: Mark[] = [];
  for (const token of tokens ?? []) {
    const active = [...marks, ...html];
    switch (token.type) {
      case "text": {
        const t = token as Tokens.Text;
        if (t.tokens?.length) out.push(...inlineContent(t.tokens, active));
        else if (t.text) out.push(textNode(decodeEntities(t.text), active));
        break;
      }
      case "escape":
        out.push(textNode((token as Tokens.Escape).text, active));
        break;
      case "strong":
        out.push(...inlineContent((token as Tokens.Strong).tokens, [...active, { type: "bold" }]));
        break;
      case "em":
        out.push(...inlineContent((token as Tokens.Em).tokens, [...active, { type: "italic" }]));
        break;
      case "del":
        out.push(...inlineContent((token as Tokens.Del).tokens, [...active, { type: "strike" }]));
        break;
      case "codespan":
        out.push(
          textNode(decodeEntities((token as Tokens.Codespan).text), [...active, { type: "code" }]),
        );
        break;
      case "br":
        out.push({ type: "hardBreak" });
        break;
      case "link": {
        const t = token as Tokens.Link;
        const link: Mark = {
          type: "link",
          attrs: { href: t.href, ...(t.title ? { title: t.title } : {}) },
        };
        out.push(
          ...inlineContent(t.tokens, [...active.filter((mark) => mark.type !== "link"), link]),
        );
        break;
      }
      case "image": {
        const t = token as Tokens.Image;
        out.push({
          type: "image",
          attrs: { src: t.href, alt: decodeEntities(t.text) || null, title: t.title || null },
        });
        break;
      }
      case "html": {
        const raw = (token as Tokens.HTML).raw.trim().toLowerCase();
        if (/^<br\s*\/?>$/.test(raw)) out.push({ type: "hardBreak" });
        else if (raw === "<u>" || raw === "<ins>") html = [...html, { type: "underline" }];
        else if (raw === "</u>" || raw === "</ins>") html = html.slice(0, -1);
        else out.push(textNode((token as Tokens.HTML).raw, active));
        break;
      }
      default:
        if ("text" in token && typeof token.text === "string" && token.text) {
          out.push(textNode(decodeEntities(token.text), active));
        }
    }
  }
  return mergeText(out);
}

/** Joins neighbouring text nodes with the same marks (ProseMirror normalises the same way). */
function mergeText(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (
      node.type === "text" &&
      last?.type === "text" &&
      JSON.stringify(last.marks ?? []) === JSON.stringify(node.marks ?? [])
    ) {
      out[out.length - 1] = { ...last, text: `${last.text ?? ""}${node.text ?? ""}` };
    } else if (node.type !== "text" || node.text) {
      out.push(node);
    }
  }
  return out;
}

/** Trims hard breaks at the edges (a trailing `\` line is not meaningful in a block). */
function trimBreaks(nodes: JSONContent[]): JSONContent[] {
  let start = 0;
  let end = nodes.length;
  while (start < end && nodes[start]!.type === "hardBreak") start += 1;
  while (end > start && nodes[end - 1]!.type === "hardBreak") end -= 1;
  return nodes.slice(start, end);
}

/** A text block, split around image nodes (images are blocks in the editor schema). */
function textBlocks(
  inline: JSONContent[],
  make: (content: JSONContent[]) => JSONContent,
): JSONContent[] {
  const blocks: JSONContent[] = [];
  let run: JSONContent[] = [];
  const flush = (force: boolean) => {
    const content = trimBreaks(run);
    if (content.length || force) blocks.push(make(content));
    run = [];
  };
  for (const node of inline) {
    if (node.type === "image") {
      flush(false);
      blocks.push(node);
    } else {
      run.push(node);
    }
  }
  flush(blocks.length === 0);
  return blocks;
}

function paragraph(content: JSONContent[]): JSONContent {
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

function listItem(item: Tokens.ListItem, task: boolean): JSONContent {
  let content = blocks(item.tokens);
  // listItem / taskItem content is `paragraph block*`.
  if (content[0]?.type !== "paragraph") content = [paragraph([]), ...content];
  return task
    ? { type: "taskItem", attrs: { checked: Boolean(item.checked) }, content }
    : { type: "listItem", content };
}

function list(token: Tokens.List): JSONContent {
  const task = token.items.length > 0 && token.items.some((item) => item.task);
  const items = token.items.map((item) => listItem(item, task));
  if (task) return { type: "taskList", content: items };
  if (token.ordered) {
    const start = typeof token.start === "number" ? token.start : 1;
    return { type: "orderedList", attrs: { start }, content: items };
  }
  return { type: "bulletList", content: items };
}

function tableCell(cell: Tokens.TableCell, header: boolean): JSONContent {
  const content = textBlocks(inlineContent(cell.tokens), paragraph).map((block) =>
    block.type === "image" ? paragraph([]) : block,
  );
  return { type: header ? "tableHeader" : "tableCell", content };
}

function table(token: Tokens.Table): JSONContent {
  const rows = [
    { type: "tableRow", content: token.header.map((cell) => tableCell(cell, true)) },
    ...token.rows.map((row) => ({
      type: "tableRow",
      content: row.map((cell) => tableCell(cell, false)),
    })),
  ];
  return { type: "table", content: rows };
}

function blockquote(token: Tokens.Blockquote): JSONContent {
  const alert = ALERT_PATTERN.exec(token.text.trimStart());
  const variant = alert ? ALERT_VARIANTS[alert[1]!.toUpperCase()] : undefined;
  if (variant) {
    const body = token.text.trimStart().slice(alert![0].length);
    const content = blocks(new Lexer({ gfm: true }).lex(body));
    return {
      type: "callout",
      attrs: { variant },
      content: content.length ? content : [paragraph([])],
    };
  }
  const content = blocks(token.tokens);
  return { type: "blockquote", content: content.length ? content : [paragraph([])] };
}

function blocks(tokens: Token[] | undefined): JSONContent[] {
  const out: JSONContent[] = [];
  for (const token of tokens ?? []) {
    switch (token.type) {
      case "space":
      case "def":
        break;
      case "heading": {
        const t = token as Tokens.Heading;
        const level = Math.min(MAX_HEADING, Math.max(1, t.depth));
        out.push(
          ...textBlocks(inlineContent(t.tokens), (content) => ({
            type: "heading",
            attrs: { level },
            ...(content.length ? { content } : {}),
          })),
        );
        break;
      }
      case "paragraph":
        out.push(...textBlocks(inlineContent((token as Tokens.Paragraph).tokens), paragraph));
        break;
      case "text": {
        // Tight list items hold bare `text` tokens instead of paragraphs.
        const t = token as Tokens.Text;
        out.push(...textBlocks(t.tokens ? inlineContent(t.tokens) : inlineContent([t]), paragraph));
        break;
      }
      case "code": {
        const t = token as Tokens.Code;
        const language = t.lang?.trim().split(/\s+/)[0] || null;
        out.push({
          type: "codeBlock",
          attrs: { language },
          ...(t.text ? { content: [{ type: "text", text: t.text }] } : {}),
        });
        break;
      }
      case "hr":
        out.push({ type: "horizontalRule" });
        break;
      case "blockquote":
        out.push(blockquote(token as Tokens.Blockquote));
        break;
      case "list":
        out.push(list(token as Tokens.List));
        break;
      case "table":
        out.push(table(token as Tokens.Table));
        break;
      case "html": {
        const raw = (token as Tokens.HTML).text.trim();
        if (raw) out.push(paragraph([{ type: "text", text: raw }]));
        break;
      }
      default:
        if ("text" in token && typeof token.text === "string" && token.text.trim()) {
          out.push(paragraph([{ type: "text", text: token.text }]));
        }
    }
  }
  return out;
}

/** Block nodes of a Markdown fragment (may be empty). */
export function markdownToBlocks(markdown: string): JSONContent[] {
  return blocks(new Lexer({ gfm: true }).lex(markdown.normalize("NFC").replace(/\r\n?/g, "\n")));
}

/** A whole document; an empty Markdown string gives a document with one empty paragraph. */
export function markdownToDoc(markdown: string): JSONContent {
  const content = markdownToBlocks(markdown);
  return { type: "doc", content: content.length ? content : [paragraph([])] };
}
