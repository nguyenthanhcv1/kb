import { getEditorSchema } from "@kb/editor";
import { extractContent, type ExtractedContent } from "@kb/editor/extract";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
import type * as Y from "yjs";

/** Y.XmlFragment the TipTap Collaboration extension binds to (its default `field`). */
export const DOCUMENT_FIELD = "default";

const schema = getEditorSchema();

export interface DerivedContent extends ExtractedContent {
  contentJson: Record<string, unknown>;
}

/**
 * TipTap JSON and search text of the in-memory Y.Doc, using the shared editor schema so what is
 * stored matches what the web editor renders. Nodes unknown to the schema are dropped by
 * y-tiptap — the Yjs state (source of truth) still keeps them.
 */
export function deriveContent(document: Y.Doc): DerivedContent {
  const root = yXmlFragmentToProseMirrorRootNode(document.getXmlFragment(DOCUMENT_FIELD), schema);
  const contentJson = root.toJSON() as Record<string, unknown>;
  return { contentJson, ...extractContent(contentJson) };
}

/**
 * TipTap/ProseMirror JSON → document node of the shared editor schema. Throws (RangeError) when
 * the JSON names unknown nodes/marks or breaks the content model (e.g. text directly in `doc`).
 */
export function parseContentJson(json: unknown): ProseMirrorNode {
  const node = schema.nodeFromJSON(json);
  if (node.type !== schema.topNodeType)
    throw new RangeError(`root must be ${schema.topNodeType.name}`);
  node.check();
  return node;
}

/**
 * Makes the Yjs fragment equal to `node`. y-tiptap diffs against the current fragment, so unchanged
 * blocks keep their Yjs items (cursors in them survive) and only the rest is deleted/inserted.
 * Call inside a transaction so connected clients receive one update.
 */
export function replaceContent(document: Y.Doc, node: ProseMirrorNode): void {
  prosemirrorToYXmlFragment(node, document.getXmlFragment(DOCUMENT_FIELD));
}
