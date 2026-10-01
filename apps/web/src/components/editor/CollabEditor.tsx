"use client";

import Collaboration, { isChangeOrigin } from "@tiptap/extension-collaboration";
import type { JSONContent } from "@tiptap/core";
import { useMemo } from "react";

import type { CollabClientConfig } from "@/lib/collab/config";
import { useCollab } from "@/lib/collab/use-collab";

import { BlockEditor } from "./block-editor";
import { CollabStatusIndicator } from "./collab-status";

type CollabEditorProps = {
  pageId: string;
  config: CollabClientConfig;
  /** Derived `content_json`: shown at once (server-rendered) while the WebSocket connects. */
  content: JSONContent | null;
  title: string;
};

/**
 * Collaborative body of a page (Yjs through kb-collab). First paint is the read-only
 * `content_json` — it never waits for the WebSocket. Once the first sync finishes, the editor
 * swaps to one bound to the Yjs document; if the connection drops later it stays mounted, so
 * typing continues and syncs on reconnect.
 */
export function CollabEditor({ pageId, config, content, title }: CollabEditorProps) {
  const collab = useCollab(pageId, config);
  const bound = collab?.synced ? collab : null;

  const extensions = useMemo(
    () => (bound ? [Collaboration.configure({ document: bound.doc })] : []),
    [bound],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="md:pl-8">
        <CollabStatusIndicator status={collab?.status ?? "connecting"} />
      </div>
      {bound ? (
        <BlockEditor
          key="collab"
          editable={bound.canWrite && bound.status !== "outdated" && bound.status !== "forbidden"}
          extensions={extensions}
          extensionOptions={{
            undoRedo: false,
            uniqueId: { filterTransaction: (tr) => !isChangeOrigin(tr) },
          }}
          title={title}
        />
      ) : (
        <BlockEditor key="static" content={content ?? undefined} editable={false} title={title} />
      )}
    </div>
  );
}
