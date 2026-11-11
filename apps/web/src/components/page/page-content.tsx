"use client";

import type { JSONContent } from "@tiptap/core";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { BlockEditor } from "@/components/editor/block-editor";
import { CollabEditor } from "@/components/editor/CollabEditor";
import type { CollabClientConfig } from "@/lib/collab/config";

/** `true` for a document without any block, or only empty paragraphs. */
export function isEmptyDocument(doc: JSONContent | null | undefined): boolean {
  const blocks = doc?.content ?? [];
  return blocks.every((block) => block.type === "paragraph" && !block.content?.length);
}

/**
 * Page body. Editors get the collaborative editor (Yjs through kb-collab: live, with the save
 * status) whenever collab is configured — read-only until `editing`; everyone else reads the
 * server-rendered `content_json`.
 */
export function PageContent({
  content,
  title,
  pageId,
  collab = null,
  editing = false,
  historyHref,
  editActions,
}: {
  content: JSONContent | null;
  title: string;
  pageId?: string;
  /** Set only when the viewer may edit this page and `COLLAB_PUBLIC_URL` is configured. */
  collab?: CollabClientConfig | null;
  /** The editor chose "Edit": the collaborative body accepts typing. */
  editing?: boolean;
  /** History route of the page, linked from the "content was restored" toast. */
  historyHref?: string;
  /** "Done" button while editing: shown next to the save status, in the sticky edit toolbar. */
  editActions?: ReactNode;
}) {
  const t = useTranslations("tree.page.content");
  if (collab && pageId) {
    return (
      <CollabEditor
        pageId={pageId}
        config={collab}
        content={content}
        title={title}
        editing={editing}
        historyHref={historyHref}
        editActions={editActions}
      />
    );
  }
  const actions = editing && editActions && <div className="flex justify-end">{editActions}</div>;
  if (!content || isEmptyDocument(content)) {
    return (
      <>
        {actions}
        <p className="text-muted-foreground md:pl-8">{t("empty")}</p>
      </>
    );
  }
  return (
    <>
      {actions}
      <BlockEditor content={content} editable={false} title={title} />
    </>
  );
}
