"use client";

import type { JSONContent } from "@tiptap/core";
import { useTranslations } from "next-intl";

import { BlockEditor } from "@/components/editor/block-editor";
import { CollabEditor } from "@/components/editor/CollabEditor";
import type { CollabClientConfig } from "@/lib/collab/config";

/** `true` for a document without any block, or only empty paragraphs. */
export function isEmptyDocument(doc: JSONContent | null | undefined): boolean {
  const blocks = doc?.content ?? [];
  return blocks.every((block) => block.type === "paragraph" && !block.content?.length);
}

/**
 * Page body. Editors get the collaborative editor (Yjs through kb-collab, with the save status)
 * whenever collab is configured; everyone else reads the server-rendered `content_json`.
 */
export function PageContent({
  content,
  title,
  pageId,
  collab = null,
}: {
  content: JSONContent | null;
  title: string;
  pageId?: string;
  /** Set only when the viewer may edit this page and `COLLAB_PUBLIC_URL` is configured. */
  collab?: CollabClientConfig | null;
}) {
  const t = useTranslations("tree.page.content");
  if (collab && pageId) {
    return <CollabEditor pageId={pageId} config={collab} content={content} title={title} />;
  }
  if (!content || isEmptyDocument(content)) {
    return <p className="text-muted-foreground md:pl-8">{t("empty")}</p>;
  }
  return <BlockEditor content={content} editable={false} title={title} />;
}
