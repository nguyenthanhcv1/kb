"use client";

import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  closestCenter,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { FileTextIcon, PlusIcon, XIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useId,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";

import { PageTreeRow, type RowHandlers, TREE_INDENT } from "./page-tree-row";
import { type PageTreeApi, serverPageTreeApi } from "./tree-api";
import { pageHref, shortIdFromPathname } from "./tree-href";
import {
  flattenTree,
  isSelfOrAncestor,
  type KeyboardMove,
  keyboardMoveTarget,
  parentKey,
  projectDrop,
  ROOT,
  treeKeyAction,
  typeaheadMatch,
} from "./tree-model";
import { usePageTree } from "./use-page-tree";
import { type TreeRealtimeSubscribe, useTreeRealtime } from "./use-tree-realtime";

type PageTreeProps = {
  space: { id: string; slug: string; name: string };
  /** Editors and admins (`canEditSpaceContent`): create, rename, move, trash. */
  canEdit: boolean;
  /** Server access; defaults to the T2.2 Server Actions. */
  api?: PageTreeApi;
  /** Live updates from other tabs/users; defaults to Supabase Realtime (T2.5). */
  subscribe?: TreeRealtimeSubscribe;
};

const KEYBOARD_MOVES: Record<string, KeyboardMove> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowRight: "indent",
  ArrowLeft: "outdent",
};

type DragState = { activeId: string; overId: string; depthDelta: number };

/**
 * Page tree of a Space in the sidebar (T2.3): WAI-ARIA tree (arrows, Home/End, type-ahead,
 * Enter follows the link), levels loaded on expand and remembered per Space, drag-and-drop to
 * reorder or nest (dnd-kit; horizontal drag changes the depth) and Alt+Shift+arrows for the
 * same from the keyboard, actions menu (… button, right click, Shift+F10), optimistic updates
 * rolled back with a translated error.
 */
export function PageTree({ space, canEdit, api = serverPageTreeApi, subscribe }: PageTreeProps) {
  const t = useTranslations("tree");
  const tErrors = useTranslations("errors");
  const pathname = usePathname();
  const router = useRouter();
  const tree = usePageTree(space.id, api);
  useTreeRealtime(space.id, tree, subscribe);
  const instructionsId = useId();

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const refs = useRef(new Map<string, HTMLElement>());
  const suppressClick = useRef(false);
  /** A menu action opens the inline title editor: closing the menu must not take focus back. */
  const renameIntent = useRef(false);

  const draggedId = drag?.activeId ?? null;
  const hidden = useMemo(() => new Set(draggedId ? [draggedId] : []), [draggedId]);
  const items = useMemo(
    () => flattenTree(tree.data, tree.expanded, hidden),
    [tree.data, tree.expanded, hidden],
  );
  const ids = useMemo(() => items.map((item) => item.id), [items]);

  const currentShortId = shortIdFromPathname(pathname, space.slug);
  const currentId = useMemo(() => {
    if (!currentShortId) return null;
    return (
      Object.values(tree.data.nodes).find((node) => node.shortId === currentShortId)?.id ?? null
    );
  }, [tree.data.nodes, currentShortId]);

  const tabbableId =
    (focusedId && ids.includes(focusedId) && focusedId) ||
    (currentId && ids.includes(currentId) && currentId) ||
    ids[0] ||
    null;

  const projection = drag
    ? projectDrop(items, drag.activeId, drag.overId, drag.depthDelta * TREE_INDENT, TREE_INDENT)
    : null;

  const label = useCallback(
    (id: string) => tree.data.nodes[id]?.title || t("untitled"),
    [tree.data.nodes, t],
  );

  const focusRow = useCallback((id: string) => {
    setFocusedId(id);
    requestAnimationFrame(() => refs.current.get(id)?.focus());
  }, []);

  const runMove = async (id: string, target: Parameters<typeof tree.move>[1]) => {
    const moved = await tree.move(id, target);
    if (moved) setAnnouncement(t("moved", { title: label(id) }));
    return moved;
  };

  // Latest closures for the rows' stable handlers.
  type LatestHandlers = Omit<RowHandlers, "registerRef" | "onClick">;
  const latest = useRef<LatestHandlers | null>(null);
  const current: LatestHandlers = {
    onFocus: setFocusedId,
    toggle(id) {
      tree.setExpandedFor(id, !tree.expanded.has(id));
    },
    onKeyDown(event: KeyboardEvent<HTMLElement>, id) {
      const move = KEYBOARD_MOVES[event.key];
      if (event.altKey && event.shiftKey && move) {
        event.preventDefault();
        if (!canEdit) return;
        const target = keyboardMoveTarget(tree.data, id, move);
        if (target) void runMove(id, target).then(() => focusRow(id));
        return;
      }
      if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
        event.preventDefault();
        setMenuId(id);
        return;
      }
      if (event.key === "F2" && canEdit) {
        event.preventDefault();
        setRenamingId(id);
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const action = treeKeyAction(items, id, event.key);
      if (action) {
        event.preventDefault();
        if (action.type === "focus") focusRow(action.id);
        else tree.setExpandedFor(action.id, action.type === "expand");
        return;
      }
      if (event.key.length === 1 && event.key.trim()) {
        const match = typeaheadMatch(items, id, event.key, label);
        if (match) {
          event.preventDefault();
          focusRow(match);
        }
      }
    },
    setMenuOpen(id, open) {
      setMenuId(open ? id : null);
    },
    afterMenuClose(id) {
      if (!renameIntent.current) refs.current.get(id)?.focus();
    },
    addSubpage(id) {
      renameIntent.current = true;
      void tree.create(id).then((newId) => {
        if (newId) setRenamingId(newId);
        else renameIntent.current = false;
      });
    },
    startRename(id) {
      renameIntent.current = true;
      setRenamingId(id);
    },
    commitRename(id, title) {
      renameIntent.current = false;
      setRenamingId(null);
      focusRow(id);
      if (title !== null) void tree.rename(id, title);
    },
    copyLink(id) {
      const node = tree.data.nodes[id];
      if (!node) return;
      const url = new URL(pageHref(space.slug, node), window.location.origin).toString();
      navigator.clipboard
        ?.writeText(url)
        .then(() => setAnnouncement(t("linkCopied")))
        .catch(() => setAnnouncement(t("copyLinkFailed")));
    },
    moveToTrash(id) {
      const title = label(id);
      const index = items.findIndex((item) => item.id === id);
      const neighbour = items[index - 1]?.id ?? items[index + 1]?.id ?? null;
      const wasOpen = currentId !== null && isSelfOrAncestor(tree.data, id, currentId);
      void tree.trash(id).then((ok) => {
        if (!ok) return;
        setAnnouncement(t("trashed", { title }));
        if (neighbour) focusRow(neighbour);
        if (wasOpen) router.push(`/s/${space.slug}`);
      });
    },
  };
  useLayoutEffect(() => {
    latest.current = current;
  });

  const handlers = useMemo<RowHandlers>(
    () => ({
      registerRef(id, element) {
        if (element) refs.current.set(id, element);
        else refs.current.delete(id);
      },
      onClick(event: MouseEvent<HTMLElement>) {
        if (suppressClick.current) event.preventDefault();
      },
      onKeyDown: (...args) => latest.current?.onKeyDown(...args),
      onFocus: (...args) => latest.current?.onFocus(...args),
      toggle: (...args) => latest.current?.toggle(...args),
      setMenuOpen: (...args) => latest.current?.setMenuOpen(...args),
      afterMenuClose: (...args) => latest.current?.afterMenuClose(...args),
      addSubpage: (...args) => latest.current?.addSubpage(...args),
      startRename: (...args) => latest.current?.startRename(...args),
      commitRename: (...args) => latest.current?.commitRename(...args),
      copyLink: (...args) => latest.current?.copyLink(...args),
      moveToTrash: (...args) => latest.current?.moveToTrash(...args),
    }),
    [],
  );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const announcements: Announcements = {
    onDragStart: ({ active }) => t("dnd.start", { title: label(String(active.id)) }),
    onDragOver: ({ active, over }) =>
      over
        ? t("dnd.over", { title: label(String(active.id)), over: label(String(over.id)) })
        : undefined,
    onDragEnd: ({ active }) => t("dnd.drop", { title: label(String(active.id)) }),
    onDragCancel: ({ active }) => t("dnd.cancel", { title: label(String(active.id)) }),
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setMenuId(null);
    setDrag({ activeId: String(active.id), overId: String(active.id), depthDelta: 0 });
  };
  const onDragMove = ({ delta }: DragMoveEvent) => {
    const depthDelta = Math.round(delta.x / TREE_INDENT);
    setDrag((current) =>
      current && current.depthDelta !== depthDelta ? { ...current, depthDelta } : current,
    );
  };
  const onDragOver = ({ over }: DragOverEvent) => {
    if (!over) return;
    setDrag((current) => (current ? { ...current, overId: String(over.id) } : current));
  };
  const onDragEnd = ({ active }: DragEndEvent) => {
    const target = projection;
    setDrag(null);
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    if (target) void runMove(String(active.id), target);
  };

  const activeNode = drag ? tree.data.nodes[drag.activeId] : undefined;
  const rootLoading = tree.loading.has(ROOT) && !tree.rootLoaded;

  const createRoot = () => {
    void tree.create(null).then((id) => {
      if (id) setRenamingId(id);
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <p id={instructionsId} className="sr-only">
        {t("dnd.instructions")}
      </p>
      {rootLoading && (
        <p className="px-2 py-1 text-xs text-muted-foreground" aria-live="polite">
          {t("loading")}
        </p>
      )}
      {tree.rootLoaded && items.length === 0 && (
        <p className="px-2 py-1 text-xs text-muted-foreground">{t("empty")}</p>
      )}

      {items.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          accessibility={{
            announcements,
            screenReaderInstructions: { draggable: t("dnd.instructions") },
          }}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDrag(null)}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul
              role="tree"
              aria-label={t("label", { space: space.name })}
              aria-describedby={canEdit ? instructionsId : undefined}
              className="flex flex-col"
            >
              {items.map((item) => {
                const node = tree.data.nodes[item.id]!;
                return (
                  <PageTreeRow
                    key={item.id}
                    item={item}
                    node={node}
                    href={pageHref(space.slug, node)}
                    current={item.id === currentId}
                    tabbable={item.id === tabbableId}
                    depth={drag?.activeId === item.id && projection ? projection.depth : item.depth}
                    loading={tree.loading.has(parentKey(item.id))}
                    renaming={renamingId === item.id}
                    menuOpen={menuId === item.id}
                    canEdit={canEdit}
                    handlers={handlers}
                  />
                );
              })}
            </ul>
          </SortableContext>
          <DragOverlay dropAnimation={null}>
            {activeNode && (
              <div className="flex h-8 items-center gap-1.5 rounded-md border bg-popover px-2 text-sm text-popover-foreground shadow-md">
                {activeNode.icon ? (
                  <span aria-hidden>{activeNode.icon}</span>
                ) : (
                  <FileTextIcon aria-hidden className="size-4 text-muted-foreground" />
                )}
                <span className="truncate">{activeNode.title || t("untitled")}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {tree.error && (
        <div
          role="alert"
          className="mx-1 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
        >
          <span className="flex-1">{tErrors(tree.error)}</span>
          <button
            type="button"
            onClick={tree.dismissError}
            aria-label={t("dismiss")}
            className="rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <XIcon aria-hidden className="size-3.5" />
          </button>
        </div>
      )}

      {canEdit && tree.rootLoaded && (
        <Button
          variant="ghost"
          size="sm"
          onClick={createRoot}
          className="justify-start px-2 text-muted-foreground"
        >
          <PlusIcon aria-hidden />
          {t("newPage")}
        </Button>
      )}

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
