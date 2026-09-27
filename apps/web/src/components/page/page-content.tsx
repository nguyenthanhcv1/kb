"use client";

import type { JSONContent } from "@tiptap/core";
import { useTranslations } from "next-intl";

import { BlockEditor } from "@/components/editor/block-editor";

/** `true` for a document without any block, or only empty paragraphs. */
export function isEmptyDocument(doc: JSONContent | null | undefined): boolean {
  const blocks = doc?.content ?? [];
  return blocks.every((block) => block.type === "paragraph" && !block.content?.length);
}

/**
 * Page body, read-only from the derived `content_json`. Editing (Yjs through kb-collab, with the
 * connection status) replaces this with the collaborative editor in T3.5.
 */
export function PageContent({ content, title }: { content: JSONContent | null; title: string }) {
  const t = useTranslations("tree.page.content");
  if (!content || isEmptyDocument(content)) {
    return <p className="text-muted-foreground">{t("empty")}</p>;
  }
  return <BlockEditor content={content} editable={false} title={title} />;
}
