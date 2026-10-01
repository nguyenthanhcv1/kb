"use client";

import { HocuspocusProvider, WebSocketStatus } from "@hocuspocus/provider";
import { useEffect, useState } from "react";
import * as Y from "yjs";

import type { CollabClientConfig } from "./config";
import {
  type CollabFailure,
  type CollabSnapshot,
  type CollabStatus,
  deriveCollabStatus,
  failureFromReason,
  tokenNeedsRefresh,
} from "./status";

export type CollabConnection = {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  status: CollabStatus;
  /** First sync with the server done: the Yjs document holds the real content. */
  synced: boolean;
  /** `false` when the server accepted the connection read-only (viewer). */
  canWrite: boolean;
};

async function fetchToken(): Promise<{ token: string; expiresAt: number }> {
  const response = await fetch("/api/collab/token", { cache: "no-store" });
  if (!response.ok) throw new Error("UNAUTHORIZED");
  return (await response.json()) as { token: string; expiresAt: number };
}

/**
 * Opens the Hocuspocus connection of one page (`page:<uuid>`). The access token is fetched from
 * `/api/collab/token` on every (re)connect and re-sent shortly before it expires; the connection
 * retries by itself, so typing offline keeps working and syncs when the network returns.
 */
export function useCollab(pageId: string, config: CollabClientConfig): CollabConnection | null {
  const [connection, setConnection] = useState<CollabConnection | null>(null);
  const { url, schemaVersion } = config;

  useEffect(() => {
    const doc = new Y.Doc();
    const state: CollabSnapshot = {
      connected: false,
      synced: false,
      unsyncedChanges: 0,
      failure: null,
    };
    let canWrite = true;
    let expiresAt = 0;
    let disposed = false;

    const separator = url.includes("?") ? "&" : "?";
    const provider = new HocuspocusProvider({
      url: `${url}${separator}schemaVersion=${schemaVersion}`,
      name: `page:${pageId}`,
      document: doc,
      token: async () => {
        const fresh = await fetchToken();
        expiresAt = fresh.expiresAt;
        return fresh.token;
      },
      onStatus: ({ status }) => {
        state.connected = status === WebSocketStatus.Connected;
        publish();
      },
      onAuthenticated: ({ scope }) => {
        canWrite = scope !== "readonly";
        publish();
      },
      onSynced: ({ state: synced }) => {
        if (synced) state.synced = true;
        publish();
      },
      onUnsyncedChanges: ({ number }) => {
        state.unsyncedChanges = number;
        publish();
      },
      onAuthenticationFailed: ({ reason }) => {
        const failure: CollabFailure | null = failureFromReason(reason);
        if (failure) {
          state.failure = failure;
          provider.disconnect();
          publish();
        }
        // Anything else (expired token): the provider reconnects and asks for a fresh token.
      },
    });

    function publish() {
      if (disposed) return;
      setConnection({
        doc,
        provider,
        status: deriveCollabStatus(state),
        synced: state.synced,
        canWrite,
      });
    }

    const refresh = window.setInterval(() => {
      if (state.connected && tokenNeedsRefresh(expiresAt, Date.now())) {
        void provider.sendToken().catch(() => undefined);
      }
    }, 30_000);

    publish();
    return () => {
      disposed = true;
      window.clearInterval(refresh);
      provider.destroy();
      doc.destroy();
    };
  }, [pageId, url, schemaVersion]);

  return connection;
}
