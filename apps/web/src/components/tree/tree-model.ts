import type { PageTreeNode } from "@/server/pages";

/**
 * Pure page-tree logic for the sidebar (T2.3): normalised state, flattening to visible rows,
 * drop projection for drag-and-drop, keyboard navigation/moves and the optimistic move.
 * No React here so it is unit-tested directly (`tree-model.test.ts`).
 */

/** Key of the root level in {@link TreeData.children} (page ids are UUIDs, never empty). */
export const ROOT = "";

export type TreeData = {
  nodes: Record<string, PageTreeNode>;
  /** Ordered child ids per parent id ({@link ROOT} for the Space roots); absent = not loaded. */
  children: Record<string, string[]>;
};

export const EMPTY_TREE: TreeData = { nodes: {}, children: {} };

export function parentKey(parentId: string | null): string {
  return parentId ?? ROOT;
}

/** A visible row of the tree, in display order. */
export type FlatItem = {
  id: string;
  parentId: string | null;
  depth: number;
  /** 1-based position among its siblings (`aria-posinset`). */
  posInSet: number;
  /** Number of siblings, itself included (`aria-setsize`). */
  setSize: number;
  hasChildren: boolean;
  expanded: boolean;
};

/**
 * Visible rows: roots, then the children of every expanded (and loaded) page, depth first.
 * `hiddenSubtrees` collapses pages without changing the expanded state (the dragged page).
 */
export function flattenTree(
  data: TreeData,
  expanded: ReadonlySet<string>,
  hiddenSubtrees: ReadonlySet<string> = new Set(),
): FlatItem[] {
  const out: FlatItem[] = [];
  const walk = (key: string, parentId: string | null, depth: number) => {
    const ids = (data.children[key] ?? []).filter((id) => data.nodes[id]);
    ids.forEach((id, index) => {
      const node = data.nodes[id]!;
      const isExpanded = node.hasChildren && expanded.has(id);
      out.push({
        id,
        parentId,
        depth,
        posInSet: index + 1,
        setSize: ids.length,
        hasChildren: node.hasChildren,
        expanded: isExpanded,
      });
      if (isExpanded && !hiddenSubtrees.has(id) && data.children[id]) walk(id, id, depth + 1);
    });
  };
  walk(ROOT, null, 0);
  return out;
}

/** Where a page lands: under `parentId`, right after sibling `afterId` (`null` = first). */
export type MoveTarget = {
  parentId: string | null;
  /** `undefined` = last (children not loaded, the server appends). */
  afterId: string | null | undefined;
};

export type DropProjection = MoveTarget & { depth: number };

/**
 * Drop target while dragging `activeId` over `overId` with a horizontal offset (px), in the
 * style of dnd-kit's sortable tree: the vertical position picks the slot, the horizontal offset
 * the depth (clamped between the next row's depth and one level under the previous row).
 * `items` must not contain the dragged page's descendants (flatten with it hidden).
 */
export function projectDrop(
  items: readonly FlatItem[],
  activeId: string,
  overId: string,
  offsetX: number,
  indentWidth: number,
): DropProjection | null {
  const activeIndex = items.findIndex((item) => item.id === activeId);
  const overIndex = items.findIndex((item) => item.id === overId);
  if (activeIndex < 0 || overIndex < 0) return null;
  const active = items[activeIndex]!;

  const moved = [...items];
  moved.splice(activeIndex, 1);
  moved.splice(overIndex, 0, active);
  const previous = moved[overIndex - 1];
  const next = moved[overIndex + 1];

  const dragDepth = Math.round(offsetX / indentWidth);
  const projected = active.depth + dragDepth;
  const maxDepth = previous ? previous.depth + 1 : 0;
  const minDepth = next ? next.depth : 0;
  const depth = Math.min(Math.max(projected, minDepth), maxDepth);

  let parentId: string | null = null;
  if (depth > 0 && previous) {
    if (depth === previous.depth) parentId = previous.parentId;
    else if (depth > previous.depth) parentId = previous.id;
    else {
      const ancestor = moved
        .slice(0, overIndex)
        .reverse()
        .find((item) => item.depth === depth);
      parentId = ancestor?.parentId ?? null;
    }
  }

  // Nearest earlier row at the same depth with the same parent = the sibling before the page.
  let afterId: string | null | undefined = null;
  for (let index = overIndex - 1; index >= 0; index--) {
    const item = moved[index]!;
    if (item.depth < depth) break;
    if (item.depth === depth && item.parentId === parentId) {
      afterId = item.id;
      break;
    }
  }
  // Dropped as the first child of a collapsed page whose children are not shown: append.
  if (previous && parentId === previous.id && previous.hasChildren && !previous.expanded) {
    afterId = undefined;
  }
  return { depth, parentId, afterId };
}

/** Current target of a page (its parent and previous sibling). */
export function currentTarget(data: TreeData, pageId: string): MoveTarget | null {
  const node = data.nodes[pageId];
  if (!node) return null;
  const siblings = data.children[parentKey(node.parentId)] ?? [];
  const index = siblings.indexOf(pageId);
  if (index < 0) return null;
  return { parentId: node.parentId, afterId: index > 0 ? siblings[index - 1]! : null };
}

/** Whether moving `pageId` to `target` changes nothing. */
export function isSameTarget(data: TreeData, pageId: string, target: MoveTarget): boolean {
  const current = currentTarget(data, pageId);
  return (
    current !== null &&
    current.parentId === target.parentId &&
    target.afterId !== undefined &&
    current.afterId === target.afterId
  );
}

/** Whether `ancestorId` is `pageId` itself or one of its loaded ancestors. */
export function isSelfOrAncestor(data: TreeData, ancestorId: string, pageId: string): boolean {
  let current: string | null = pageId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = data.nodes[current]?.parentId ?? null;
  }
  return false;
}

/**
 * Optimistic move: detaches the page and inserts it after `afterId` under its new parent (when
 * that level is loaded; otherwise the page shows up once the parent is expanded).
 */
export function applyMove(data: TreeData, pageId: string, target: MoveTarget): TreeData {
  const node = data.nodes[pageId];
  if (!node) return data;
  const children = { ...data.children };
  const nodes = { ...data.nodes };
  const oldKey = parentKey(node.parentId);
  const newKey = parentKey(target.parentId);

  if (children[oldKey]) children[oldKey] = children[oldKey].filter((id) => id !== pageId);
  if (node.parentId && nodes[node.parentId] && children[oldKey]?.length === 0) {
    nodes[node.parentId] = { ...nodes[node.parentId]!, hasChildren: false };
  }

  const newParent = target.parentId ? nodes[target.parentId] : undefined;
  let siblings = children[newKey];
  // A page without children has an (implicitly) empty, loaded level.
  if (!siblings && newParent && !newParent.hasChildren) siblings = [];
  if (siblings) {
    const list = siblings.filter((id) => id !== pageId);
    const index =
      target.afterId === undefined
        ? list.length
        : target.afterId === null
          ? 0
          : list.indexOf(target.afterId) + 1;
    list.splice(index < 0 ? list.length : index, 0, pageId);
    children[newKey] = list;
  }
  if (newParent) nodes[target.parentId!] = { ...newParent, hasChildren: true };
  nodes[pageId] = { ...node, parentId: target.parentId };
  return { nodes, children };
}

/** Removes a page (and its loaded subtree) from the tree — optimistic trash. */
export function applyRemove(data: TreeData, pageId: string): TreeData {
  const node = data.nodes[pageId];
  if (!node) return data;
  const nodes = { ...data.nodes };
  const children = { ...data.children };
  const key = parentKey(node.parentId);
  if (children[key]) children[key] = children[key].filter((id) => id !== pageId);
  if (node.parentId && nodes[node.parentId] && children[key]?.length === 0) {
    nodes[node.parentId] = { ...nodes[node.parentId]!, hasChildren: false };
  }
  const drop = (id: string) => {
    for (const child of children[id] ?? []) drop(child);
    delete children[id];
    delete nodes[id];
  };
  drop(pageId);
  return { nodes, children };
}

/** Stores a loaded level (replacing the previous one) and updates the parent's `hasChildren`. */
export function applyChildren(
  data: TreeData,
  parentId: string | null,
  pages: readonly PageTreeNode[],
): TreeData {
  const nodes = { ...data.nodes };
  for (const page of pages) nodes[page.id] = page;
  if (parentId && nodes[parentId]) {
    nodes[parentId] = { ...nodes[parentId]!, hasChildren: pages.length > 0 };
  }
  return {
    nodes,
    children: { ...data.children, [parentKey(parentId)]: pages.map((page) => page.id) },
  };
}

/** Adds a new page after `afterId` (omitted = last) under its parent. */
export function applyInsert(data: TreeData, page: PageTreeNode, afterId?: string | null): TreeData {
  const withNode = { ...data, nodes: { ...data.nodes, [page.id]: page } };
  return applyMove(withNode, page.id, { parentId: page.parentId, afterId });
}

export type KeyboardMove = "up" | "down" | "indent" | "outdent";

/**
 * Target of a keyboard move (Alt+Shift+arrows): up/down among siblings, indent = last child of
 * the previous sibling, outdent = right after the parent. `null` when not possible.
 */
export function keyboardMoveTarget(
  data: TreeData,
  pageId: string,
  move: KeyboardMove,
): MoveTarget | null {
  const node = data.nodes[pageId];
  if (!node) return null;
  const siblings = data.children[parentKey(node.parentId)] ?? [];
  const index = siblings.indexOf(pageId);
  if (index < 0) return null;
  switch (move) {
    case "up":
      return index === 0
        ? null
        : { parentId: node.parentId, afterId: index >= 2 ? siblings[index - 2]! : null };
    case "down":
      return index >= siblings.length - 1
        ? null
        : { parentId: node.parentId, afterId: siblings[index + 1]! };
    case "indent": {
      if (index === 0) return null;
      const newParent = siblings[index - 1]!;
      const newSiblings = data.children[newParent];
      const parentNode = data.nodes[newParent];
      if (newSiblings) return { parentId: newParent, afterId: newSiblings.at(-1) ?? null };
      return { parentId: newParent, afterId: parentNode?.hasChildren ? undefined : null };
    }
    case "outdent": {
      if (!node.parentId) return null;
      const parent = data.nodes[node.parentId];
      return parent ? { parentId: parent.parentId, afterId: parent.id } : null;
    }
  }
}

export type TreeKeyAction =
  { type: "focus"; id: string } | { type: "expand"; id: string } | { type: "collapse"; id: string };

/** WAI-ARIA tree navigation for `key` pressed on row `currentId`. */
export function treeKeyAction(
  items: readonly FlatItem[],
  currentId: string,
  key: string,
): TreeKeyAction | null {
  const index = items.findIndex((item) => item.id === currentId);
  if (index < 0) return items[0] ? { type: "focus", id: items[0].id } : null;
  const item = items[index]!;
  switch (key) {
    case "ArrowDown":
      return items[index + 1] ? { type: "focus", id: items[index + 1]!.id } : null;
    case "ArrowUp":
      return index > 0 ? { type: "focus", id: items[index - 1]!.id } : null;
    case "Home":
      return { type: "focus", id: items[0]!.id };
    case "End":
      return { type: "focus", id: items.at(-1)!.id };
    case "ArrowRight":
      if (!item.hasChildren) return null;
      if (!item.expanded) return { type: "expand", id: item.id };
      return items[index + 1]?.parentId === item.id
        ? { type: "focus", id: items[index + 1]!.id }
        : null;
    case "ArrowLeft":
      if (item.expanded) return { type: "collapse", id: item.id };
      return item.parentId ? { type: "focus", id: item.parentId } : null;
    default:
      return null;
  }
}

/** Type-ahead: next row after `currentId` (wrapping) whose label starts with `char`. */
export function typeaheadMatch(
  items: readonly FlatItem[],
  currentId: string,
  char: string,
  label: (id: string) => string,
): string | null {
  const needle = char.toLocaleLowerCase();
  const start = items.findIndex((item) => item.id === currentId);
  for (let step = 1; step <= items.length; step++) {
    const item = items[(start + step) % items.length]!;
    if (label(item.id).trim().toLocaleLowerCase().startsWith(needle)) return item.id;
  }
  return null;
}

const EXPANDED_KEY = "kb.tree.expanded.";

/** Expanded pages of a Space remembered in this browser (empty when storage is unavailable). */
export function loadExpanded(spaceId: string): string[] {
  try {
    const raw = window.localStorage.getItem(EXPANDED_KEY + spaceId);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function saveExpanded(spaceId: string, ids: Iterable<string>): void {
  try {
    window.localStorage.setItem(EXPANDED_KEY + spaceId, JSON.stringify([...ids]));
  } catch {
    // Private mode / blocked storage: the tree just forgets what was open.
  }
}
