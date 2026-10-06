import type { JSONContent } from "@tiptap/core";

import { BLOCK_ID_TYPES, getEditorSchema } from "../extensions/index";
import { markdownToBlocks } from "./from-markdown";
import { blockToMarkdown } from "./to-markdown";

/**
 * Block-level helpers for editing a stored document from outside the editor (MCP connector).
 *
 * Content written by kb-collab keeps the block IDs it is given, so new blocks need an ID here
 * (what UniqueID would do in an editor), and blocks an edit did not touch must keep theirs:
 * deep links, comments (V2) and RAG citations (V3) point at them.
 */

const BLOCK_ID_SET = new Set<string>(BLOCK_ID_TYPES);

export type BlockIdGenerator = () => string;

const defaultGenerator: BlockIdGenerator = () => globalThis.crypto.randomUUID();

/** Gives every block node without an `id` a fresh one (returns a new tree). */
export function assignBlockIds(
  node: JSONContent,
  generate: BlockIdGenerator = defaultGenerator,
  seen: Set<string> = new Set(),
): JSONContent {
  let attrs = node.attrs;
  if (node.type && BLOCK_ID_SET.has(node.type)) {
    const current = typeof attrs?.id === "string" && attrs.id ? attrs.id : null;
    const id = current && !seen.has(current) ? current : generate();
    seen.add(id);
    attrs = { ...attrs, id };
  }
  const content = node.content?.map((child) => assignBlockIds(child, generate, seen));
  return { ...node, ...(attrs ? { attrs } : {}), ...(content ? { content } : {}) };
}

/**
 * Top-level blocks of `next` whose Markdown equals a not-yet-used top-level block of `previous`
 * are replaced by that previous block as stored — IDs, merged cells, colours and widths included.
 * So re-sending a whole page as Markdown only changes the blocks that really changed.
 */
export function reuseUnchangedBlocks(previous: JSONContent, next: JSONContent): JSONContent {
  const pool = new Map<string, JSONContent[]>();
  for (const block of previous.content ?? []) {
    const key = blockToMarkdown(block);
    pool.set(key, [...(pool.get(key) ?? []), block]);
  }
  const content = (next.content ?? []).map((block) => {
    const candidates = pool.get(blockToMarkdown(block));
    return candidates?.shift() ?? block;
  });
  return { ...next, content };
}

export interface DocumentBlock {
  /** Stable block ID (`null` for content stored before IDs were assigned). */
  id: string | null;
  type: string;
  markdown: string;
}

/** Top-level blocks with their IDs, for targeted edits. */
export function listBlocks(doc: JSONContent): DocumentBlock[] {
  return (doc.content ?? []).map((block) => ({
    id: typeof block.attrs?.id === "string" ? block.attrs.id : null,
    type: block.type ?? "unknown",
    markdown: blockToMarkdown(block),
  }));
}

export type BlockEdit =
  /** Replace a top-level block with the blocks of `markdown` (empty = delete). */
  | { op: "replace"; blockId: string; markdown: string }
  /** Insert after a top-level block; `afterBlockId: null` = at the start. */
  | { op: "insert"; afterBlockId: string | null; markdown: string }
  | { op: "delete"; blockId: string }
  /** Append at the end of the document. */
  | { op: "append"; markdown: string };

export class BlockEditError extends Error {
  constructor(
    readonly code: "BLOCK_NOT_FOUND" | "CONTENT_INVALID",
    readonly blockId?: string,
  ) {
    super(blockId ? `${code}: ${blockId}` : code);
    this.name = "BlockEditError";
  }
}

/** Applies edits in order to the top-level blocks of `doc`; untouched blocks stay as stored. */
export function applyBlockEdits(doc: JSONContent, edits: readonly BlockEdit[]): JSONContent {
  const content = [...(doc.content ?? [])];
  const indexOf = (blockId: string) => {
    const index = content.findIndex((block) => block.attrs?.id === blockId);
    if (index < 0) throw new BlockEditError("BLOCK_NOT_FOUND", blockId);
    return index;
  };
  for (const edit of edits) {
    switch (edit.op) {
      case "replace":
        content.splice(indexOf(edit.blockId), 1, ...markdownToBlocks(edit.markdown));
        break;
      case "delete":
        content.splice(indexOf(edit.blockId), 1);
        break;
      case "insert": {
        const at = edit.afterBlockId === null ? 0 : indexOf(edit.afterBlockId) + 1;
        content.splice(at, 0, ...markdownToBlocks(edit.markdown));
        break;
      }
      case "append":
        content.push(...markdownToBlocks(edit.markdown));
        break;
    }
  }
  return { ...doc, type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/** Throws `BlockEditError("CONTENT_INVALID")` unless `doc` fits the shared editor schema. */
export function assertValidDocument(doc: JSONContent): void {
  try {
    const schema = getEditorSchema();
    const node = schema.nodeFromJSON(doc);
    if (node.type !== schema.topNodeType) throw new RangeError("root must be doc");
    node.check();
  } catch (error) {
    throw Object.assign(new BlockEditError("CONTENT_INVALID"), { cause: error });
  }
}
