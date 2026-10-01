"use client";

import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { useEffect, useRef } from "react";

import { createClient } from "@/lib/supabase/client";

import { pageFromRow } from "./tree-realtime";
import type { PageTreeActions } from "./use-page-tree";

type Row = Record<string, unknown>;

/**
 * Keeps the tree of a Space in sync with other tabs/users: subscribes to `postgres_changes` on
 * `pages` (RLS limits what we receive) and applies each change to the tree store. After the
 * connection drops and returns, loaded levels are reloaded so missed changes are not lost.
 * `subscribe` is injectable for tests; the default opens a Supabase channel.
 */
export function useTreeRealtime(
  spaceId: string,
  tree: Pick<PageTreeActions, "applyRemote" | "refresh">,
  subscribe: TreeRealtimeSubscribe = subscribeSupabase,
) {
  const treeRef = useRef(tree);
  useEffect(() => {
    treeRef.current = tree;
  });

  useEffect(() => {
    let connected = false;
    return subscribe(spaceId, {
      change: (change) => treeRef.current.applyRemote(change),
      status: (online) => {
        // First connect needs no reload (the tree just loaded); a reconnect does.
        if (online && connected) void treeRef.current.refresh();
        if (online) connected = true;
      },
    });
  }, [spaceId, subscribe]);
}

export type TreeRealtimeHandlers = {
  change(change: Parameters<PageTreeActions["applyRemote"]>[0]): void;
  status(online: boolean): void;
};
export type TreeRealtimeSubscribe = (spaceId: string, handlers: TreeRealtimeHandlers) => () => void;

const subscribeSupabase: TreeRealtimeSubscribe = (spaceId, handlers) => {
  let supabase: ReturnType<typeof createClient>;
  try {
    supabase = createClient();
  } catch {
    return () => {}; // No Supabase settings (tests, previews): the tree just is not live.
  }
  const channel = supabase
    .channel(`page-tree:${spaceId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "pages", filter: `space_id=eq.${spaceId}` },
      (payload: RealtimePostgresChangesPayload<Row>) => {
        if (payload.eventType === "DELETE") {
          const id = (payload.old as Row).id;
          if (typeof id === "string") handlers.change({ removedId: id });
          return;
        }
        const page = pageFromRow(payload.new);
        if (page) handlers.change({ page });
      },
    )
    .subscribe((status) => handlers.status(status === "SUBSCRIBED"));
  return () => {
    void supabase.removeChannel(channel);
  };
};
