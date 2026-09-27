#!/usr/bin/env node
// Decodes Yjs documents exported from a restored database (docs/PLAN.md §7.8: "decode ngẫu nhiên
// 20 ydoc"). Input on stdin = output of `kb-backup export-ydoc`, one page per line:
//   <page_id> TAB <1 if content_text is not empty, else 0> TAB <base64 Y.encodeStateAsUpdate>
// Each update must apply to a fresh Y.Doc; a page with search text must have a non-empty
// "default" XML fragment (kb-collab's DOCUMENT_FIELD). Exit 1 when any page fails.
//   kb-backup export-ydoc --limit 20 | node scripts/backup/verify-ydoc.mjs
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// yjs is a dependency of kb-collab, not of the repo root: resolve it from there.
const require = createRequire(new URL("../../apps/collab/package.json", import.meta.url));
/** @type {typeof import("yjs")} */
const Y = require("yjs");

/** kb-collab binds TipTap to this fragment (apps/collab/src/content.ts DOCUMENT_FIELD). */
export const DOCUMENT_FIELD = "default";

/**
 * @param {string} line
 * @returns {{ pageId: string, ok: boolean, blocks: number, bytes: number, error?: string }}
 */
export function verifyLine(line) {
  const [pageId = "", hasText = "", base64 = ""] = line.split("\t");
  const bytes = Buffer.from(base64, "base64");
  if (!/^[0-9a-f-]{36}$/.test(pageId) || bytes.length < 2) {
    return { pageId, ok: false, blocks: 0, bytes: bytes.length, error: "malformed line" };
  }
  try {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(bytes));
    const blocks = doc.getXmlFragment(DOCUMENT_FIELD).length;
    // Yjs keeps unknown struct refs pending instead of throwing: a truncated update shows up here.
    const pending = doc.store.pendingStructs !== null || doc.store.pendingDs !== null;
    doc.destroy();
    if (pending)
      return { pageId, ok: false, blocks, bytes: bytes.length, error: "incomplete update" };
    if (hasText === "1" && blocks === 0) {
      return { pageId, ok: false, blocks, bytes: bytes.length, error: "text but empty document" };
    }
    return { pageId, ok: true, blocks, bytes: bytes.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { pageId, ok: false, blocks: 0, bytes: bytes.length, error: message };
  }
}

/** @param {string} input */
export function verifyAll(input) {
  const results = input
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(verifyLine);
  return { checked: results.length, failed: results.filter((r) => !r.ok), results };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const { checked, failed } = verifyAll(Buffer.concat(chunks).toString("utf8"));
  for (const f of failed) console.error(`ydoc ${f.pageId}: ${f.error} (${f.bytes} bytes)`);
  console.log(JSON.stringify({ checked, failed: failed.length }));
  process.exit(failed.length > 0 ? 1 : 0);
}
