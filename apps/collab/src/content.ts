import { getEditorSchema } from "@kb/editor";
import { extractContent, type ExtractedContent } from "@kb/editor/extract";
import { yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
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
