"use client";

import Collaboration, { isChangeOrigin } from "@tiptap/extension-collaboration";
import type { JSONContent } from "@tiptap/core";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { CollabClientConfig } from "@/lib/collab/config";
import { type DocumentReplaced, parseDocumentReplaced } from "@/lib/collab/replaced";
import { useCollab } from "@/lib/collab/use-collab";

import { BlockEditor } from "./block-editor";
import { CollabStatusIndicator } from "./collab-status";
import { DocumentReplacedToast } from "./document-replaced-toast";

type CollabEditorProps = {
  pageId: string;
  config: CollabClientConfig;
  /** Derived `content_json`: shown at once (server-rendered) while the WebSocket connects. */
  content: JSONContent | null;
  title: string;
  /** Edit mode: typing allowed. Otherwise the page is read live (others' edits show) but locked. */
  editing?: boolean;
  /** `/s/<space>/p/<ref>/history`, linked from the "content was restored" toast. */
  historyHref?: string;
};

/**
 * Collaborative body of a page (Yjs through kb-collab). First paint is the read-only
 * `content_json` — it never waits for the WebSocket. Once the first sync finishes, the editor
 * swaps to one bound to the Yjs document; if the connection drops later it stays mounted, so
 * typing continues and syncs on reconnect.
 */
export function CollabEditor({
  pageId,
  config,
  content,
  title,
  editing = true,
  historyHref,
}: CollabEditorProps) {
  const collab = useCollab(pageId, config);
  const bound = collab?.synced ? collab : null;
  const provider = collab?.provider ?? null;

  // The content was replaced for everyone (restore, template, import): the Yjs document already
  // carries it, the toast only tells the user why the text changed.
  const [replaced, setReplaced] = useState<DocumentReplaced | null>(null);
  const dismissReplaced = useCallback(() => setReplaced(null), []);
  useEffect(() => {
    if (!provider) return;
    const onStateless = ({ payload }: { payload: string }) => {
      const message = parseDocumentReplaced(payload);
      if (message) setReplaced(message);
    };
    provider.on("stateless", onStateless);
    return () => {
      provider.off("stateless", onStateless);
    };
  }, [provider]);

  const extensions = useMemo(
    () => (bound ? [Collaboration.configure({ document: bound.doc })] : []),
    [bound],
  );

  const status = collab?.status ?? "connecting";
  // While reading, the save status only shows when something needs attention (unsaved changes
  // after "Done", offline, a reload needed).
  const showStatus = editing || (status !== "saved" && status !== "connecting");

  return (
    <div className="flex flex-col gap-3">
      {showStatus && (
        <div className="md:pl-8">
          <CollabStatusIndicator status={status} />
        </div>
      )}
      {bound ? (
        <BlockEditor
          key="collab"
          editable={
            editing && bound.canWrite && bound.status !== "outdated" && bound.status !== "forbidden"
          }
          extensions={extensions}
          extensionOptions={{
            undoRedo: false,
            uniqueId: { filterTransaction: (tr) => !isChangeOrigin(tr) },
          }}
          title={title}
          pageId={pageId}
        />
      ) : (
        <BlockEditor key="static" content={content ?? undefined} editable={false} title={title} />
      )}
      {replaced && (
        <DocumentReplacedToast
          reason={replaced.reason}
          historyHref={historyHref}
          onDismiss={dismissReplaced}
        />
      )}
    </div>
  );
}
