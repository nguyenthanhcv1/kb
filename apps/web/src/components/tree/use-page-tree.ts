"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { PageErrorCode, PageSummary, PageTreeNode } from "@/server/pages";

import type { PageTreeApi } from "./tree-api";
import {
  applyChildren,
  applyInsert,
  applyMove,
  applyRemote,
  applyRemove,
  currentTarget,
  EMPTY_TREE,
  isSameTarget,
  isSelfOrAncestor,
  loadExpanded,
  type MoveTarget,
  parentKey,
  ROOT,
  saveExpanded,
  type TreeData,
} from "./tree-model";

export type PageTreeState = {
  data: TreeData;
  expanded: ReadonlySet<string>;
  /** Parent keys being loaded (`ROOT` = the Space roots). */
  loading: ReadonlySet<string>;
  error: PageErrorCode | null;
};

export type PageTreeActions = {
  /** Loads a level (`null` = roots) unless it is loading already. */
  load(parentId: string | null): Promise<void>;
  setExpandedFor(pageId: string, open: boolean): void;
  dismissError(): void;
  /** Optimistic move with rollback; resolves `false` when nothing moved. */
  move(pageId: string, target: MoveTarget): Promise<boolean>;
  rename(pageId: string, title: string): Promise<boolean>;
  trash(pageId: string): Promise<boolean>;
  /** Creates an untitled page (last child of `parentId`) and resolves its id. */
  create(parentId: string | null): Promise<string | null>;
  /** Applies a page changed by someone else (Realtime); `null` page = removed by id. */
  applyRemote(change: { page: PageSummary } | { removedId: string }): void;
  /** Reloads every loaded level, e.g. after the Realtime connection dropped and came back. */
  refresh(): Promise<void>;
  getState(): PageTreeState;
};

function merge(node: PageTreeNode | undefined, page: PageSummary): PageTreeNode {
  return { ...page, hasChildren: node?.hasChildren ?? false };
}

/**
 * State of the sidebar page tree of one Space, kept in a small external store (read with
 * `useSyncExternalStore`) so async actions always see the latest tree. Levels load lazily, the
 * expanded pages are remembered per Space in localStorage, and edits are applied optimistically
 * then rolled back with an error code (`errors.<code>`) when the server refuses them.
 */
export function createPageTreeStore(spaceId: string, api: PageTreeApi) {
  let state: PageTreeState = {
    data: EMPTY_TREE,
    expanded: new Set(loadExpanded(spaceId)),
    loading: new Set(),
    error: null,
  };
  const listeners = new Set<() => void>();
  const failed = new Set<string>();

  const set = (patch: Partial<PageTreeState>) => {
    state = { ...state, ...patch };
    if (patch.expanded) saveExpanded(spaceId, patch.expanded);
    for (const listener of listeners) listener();
  };
  const update = (fn: (data: TreeData) => TreeData) => set({ data: fn(state.data) });
  const setLoading = (key: string, on: boolean) => {
    const loading = new Set(state.loading);
    if (on) loading.add(key);
    else loading.delete(key);
    set({ loading });
  };

  const setExpandedFor = (pageId: string, open: boolean) => {
    failed.delete(pageId);
    if (state.expanded.has(pageId) === open) return;
    const expanded = new Set(state.expanded);
    if (open) expanded.add(pageId);
    else expanded.delete(pageId);
    set({ expanded });
  };

  const actions: PageTreeActions = {
    getState: () => state,

    async load(parentId) {
      const key = parentKey(parentId);
      if (state.loading.has(key)) return;
      setLoading(key, true);
      try {
        const result = await api.listChildren({ spaceId, parentId });
        if (result.ok) update((data) => applyChildren(data, parentId, result.data));
        else {
          set({ error: result.code });
          if (parentId) setExpandedFor(parentId, false);
          // After collapsing (which clears it): no automatic retry until expanded again.
          failed.add(key);
        }
      } finally {
        setLoading(key, false);
      }
    },

    applyRemote(change) {
      update((data) =>
        "page" in change ? applyRemote(data, change.page) : applyRemove(data, change.removedId),
      );
    },

    async refresh() {
      const keys = Object.keys(state.data.children);
      await Promise.all(keys.map((key) => actions.load(key === ROOT ? null : key)));
    },

    setExpandedFor,
    dismissError: () => set({ error: null }),

    async move(pageId, target) {
      const before = state.data;
      if (isSameTarget(before, pageId, target)) return false;
      if (target.parentId && isSelfOrAncestor(before, pageId, target.parentId)) {
        set({ error: "PAGE_MOVE_CYCLE" });
        return false;
      }
      const original = currentTarget(before, pageId);
      const node = before.nodes[pageId];
      update((data) => applyMove(data, pageId, target));
      if (target.parentId) setExpandedFor(target.parentId, true);

      const result = await api.move({
        pageId,
        parentId: target.parentId,
        ...(target.afterId === undefined ? {} : { afterId: target.afterId }),
      });
      if (result.ok) {
        update((data) => ({
          ...data,
          nodes: { ...data.nodes, [pageId]: merge(data.nodes[pageId], result.data) },
        }));
        return true;
      }
      update((data) => {
        const back = original ? applyMove(data, pageId, original) : data;
        return node ? { ...back, nodes: { ...back.nodes, [pageId]: node } } : back;
      });
      set({ error: result.code });
      return false;
    },

    async rename(pageId, title) {
      const node = state.data.nodes[pageId];
      if (!node) return false;
      const trimmed = title.replace(/\s+/g, " ").trim();
      if (trimmed === node.title) return true;
      const patch = (fn: (current: PageTreeNode) => PageTreeNode) =>
        update((data) => ({
          ...data,
          nodes: { ...data.nodes, [pageId]: fn(data.nodes[pageId] ?? node) },
        }));
      patch((current) => ({ ...current, title: trimmed }));
      const result = await api.rename({ pageId, title: trimmed });
      if (result.ok) {
        patch((current) => merge(current, result.data));
        return true;
      }
      patch((current) => ({ ...current, title: node.title }));
      set({ error: result.code });
      return false;
    },

    async trash(pageId) {
      const snapshot = state.data;
      if (!snapshot.nodes[pageId]) return false;
      update((data) => applyRemove(data, pageId));
      const result = await api.trash({ pageId });
      if (result.ok) return true;
      set({ data: snapshot, error: result.code });
      return false;
    },

    async create(parentId) {
      const result = await api.create({ spaceId, parentId, title: "" });
      if (!result.ok) {
        set({ error: result.code });
        return null;
      }
      const page: PageTreeNode = { ...result.data, hasChildren: false };
      update((data) => {
        const parent = parentId ? data.nodes[parentId] : undefined;
        // Parent's children not loaded yet: they load (new page included) when it expands.
        if (parent?.hasChildren && !data.children[parentId!]) {
          return { ...data, nodes: { ...data.nodes, [page.id]: page } };
        }
        return applyInsert(data, page);
      });
      if (parentId) setExpandedFor(parentId, true);
      return page.id;
    },
  };

  return {
    actions,
    /** Levels to fetch now: the roots once, then every expanded page not loaded yet. */
    pendingLoads(): (string | null)[] {
      const { data, expanded, loading } = state;
      const wanted = (key: string) => !data.children[key] && !loading.has(key) && !failed.has(key);
      const pages = [...expanded].filter((id) => data.nodes[id]?.hasChildren && wanted(id));
      return wanted(ROOT) ? [null, ...pages] : pages;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type UsePageTree = PageTreeState & PageTreeActions & { rootLoaded: boolean };

/** React binding of {@link createPageTreeStore}; remount (e.g. `key={spaceId}`) per Space. */
export function usePageTree(spaceId: string, api: PageTreeApi): UsePageTree {
  const [store] = useState(() => createPageTreeStore(spaceId, api));
  const state = useSyncExternalStore(
    store.subscribe,
    store.actions.getState,
    store.actions.getState,
  );

  useEffect(() => {
    for (const parentId of store.pendingLoads()) void store.actions.load(parentId);
  }, [store, state]);

  return useMemo(
    () => ({ ...state, ...store.actions, rootLoaded: state.data.children[ROOT] !== undefined }),
    [state, store],
  );
}
