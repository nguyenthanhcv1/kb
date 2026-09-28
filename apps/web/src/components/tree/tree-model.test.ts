// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PageTreeNode } from "@/server/pages";

import { pageHref, shortIdFromPathname } from "./tree-href";
import {
  applyChildren,
  applyInsert,
  applyMove,
  applyRemove,
  EMPTY_TREE,
  flattenTree,
  isSameTarget,
  isSelfOrAncestor,
  keyboardMoveTarget,
  loadExpanded,
  projectDrop,
  ROOT,
  saveExpanded,
  type TreeData,
  treeKeyAction,
  typeaheadMatch,
} from "./tree-model";

const SPACE = "5bace000-0000-4000-8000-000000000001";

function page(id: string, parentId: string | null, hasChildren = false): PageTreeNode {
  return {
    id,
    spaceId: SPACE,
    parentId,
    shortId: `${id}0000000`.slice(0, 8),
    slug: id,
    title: id.toUpperCase(),
    icon: null,
    position: "V",
    lastEditedAt: "2026-09-26T09:00:00+00:00",
    deletedAt: null,
    hasChildren,
  };
}

/**
 * a
 * ├─ a1
 * └─ a2
 * b
 * c (has children, not loaded)
 */
function sample(): TreeData {
  let data = applyChildren(EMPTY_TREE, null, [
    page("a", null, true),
    page("b", null),
    page("c", null, true),
  ]);
  data = applyChildren(data, "a", [page("a1", "a"), page("a2", "a")]);
  return data;
}

const ids = (data: TreeData, expanded: string[] = ["a"]) =>
  flattenTree(data, new Set(expanded)).map((item) => item.id);

describe("flattenTree", () => {
  it("lists roots and the children of expanded, loaded pages in order", () => {
    const data = sample();
    expect(ids(data, [])).toEqual(["a", "b", "c"]);
    expect(ids(data)).toEqual(["a", "a1", "a2", "b", "c"]);
    // `c` is expanded but its level is not loaded yet.
    expect(ids(data, ["a", "c"])).toEqual(["a", "a1", "a2", "b", "c"]);
  });

  it("computes depth, set size and position for aria attributes", () => {
    const items = flattenTree(sample(), new Set(["a"]));
    expect(items[1]).toMatchObject({ id: "a1", parentId: "a", depth: 1, posInSet: 1, setSize: 2 });
    expect(items[0]).toMatchObject({ depth: 0, posInSet: 1, setSize: 3, expanded: true });
    expect(items[4]).toMatchObject({ id: "c", hasChildren: true, expanded: false });
  });

  it("hides the subtree of the dragged page", () => {
    expect(flattenTree(sample(), new Set(["a"]), new Set(["a"])).map((i) => i.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("flattens 200 pages quickly", () => {
    const roots = Array.from({ length: 20 }, (_, i) => page(`r${i}`, null, true));
    let data = applyChildren(EMPTY_TREE, null, roots);
    for (const root of roots) {
      data = applyChildren(
        data,
        root.id,
        Array.from({ length: 9 }, (_, j) => page(`${root.id}-${j}`, root.id)),
      );
    }
    const start = performance.now();
    const items = flattenTree(data, new Set(roots.map((r) => r.id)));
    expect(items).toHaveLength(200);
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe("projectDrop", () => {
  const items = () => flattenTree(sample(), new Set(["a"]));
  const INDENT = 16;

  it("reorders among siblings without horizontal movement", () => {
    // Drag b up over a2: it lands between a1 and a2, so it joins them under `a`.
    expect(projectDrop(items(), "b", "a2", 0, INDENT)).toEqual({
      depth: 1,
      parentId: "a",
      afterId: "a1",
    });
    // Drag c over b → c goes before b... after `a` at the root.
    expect(projectDrop(items(), "c", "b", 0, INDENT)).toEqual({
      depth: 0,
      parentId: null,
      afterId: "a",
    });
    // Drag a1 down over a2 → after a2 in a.
    expect(projectDrop(items(), "a1", "a2", 0, INDENT)).toEqual({
      depth: 1,
      parentId: "a",
      afterId: "a2",
    });
  });

  it("nests under the previous row when dragged to the right", () => {
    expect(projectDrop(items(), "b", "b", INDENT, INDENT)).toEqual({
      depth: 1,
      parentId: "a",
      afterId: "a2",
    });
    // Further right than one level below the previous row is clamped.
    expect(projectDrop(items(), "b", "b", 5 * INDENT, INDENT)).toMatchObject({
      depth: 2,
      parentId: "a2",
      afterId: null,
    });
  });

  it("moves out of the parent when dragged to the left", () => {
    expect(projectDrop(items(), "a2", "a2", -INDENT, INDENT)).toEqual({
      depth: 0,
      parentId: null,
      afterId: "a",
    });
    // a1 cannot leave `a` while a2 is below it at depth 1.
    expect(projectDrop(items(), "a1", "a1", -INDENT, INDENT)).toMatchObject({
      depth: 1,
      parentId: "a",
      afterId: null,
    });
  });

  it("appends into a collapsed page whose children are not shown", () => {
    const list = flattenTree(sample(), new Set(["a"]));
    // Move b to the end (over c) then right → child of c, which has unloaded children.
    expect(projectDrop(list, "b", "c", INDENT, INDENT)).toEqual({
      depth: 1,
      parentId: "c",
      afterId: undefined,
    });
  });

  it("returns null for unknown rows", () => {
    expect(projectDrop(items(), "x", "a", 0, INDENT)).toBeNull();
  });
});

describe("applyMove / applyRemove / applyInsert", () => {
  it("moves a page within its level and into another", () => {
    let data = applyMove(sample(), "b", { parentId: null, afterId: null });
    expect(data.children[ROOT]).toEqual(["b", "a", "c"]);
    data = applyMove(data, "a2", { parentId: "b", afterId: null });
    expect(data.children.a).toEqual(["a1"]);
    expect(data.children.b).toEqual(["a2"]);
    expect(data.nodes.b!.hasChildren).toBe(true);
    expect(data.nodes.a2!.parentId).toBe("b");
  });

  it("clears hasChildren when the last child leaves", () => {
    let data = applyMove(sample(), "a1", { parentId: null, afterId: undefined });
    data = applyMove(data, "a2", { parentId: null, afterId: "a" });
    expect(data.children[ROOT]).toEqual(["a", "a2", "b", "c", "a1"]);
    expect(data.nodes.a!.hasChildren).toBe(false);
  });

  it("does not insert into a level that is not loaded", () => {
    const data = applyMove(sample(), "b", { parentId: "c", afterId: undefined });
    expect(data.children.c).toBeUndefined();
    expect(data.children[ROOT]).toEqual(["a", "c"]);
    expect(data.nodes.b!.parentId).toBe("c");
  });

  it("removes a page with its loaded subtree", () => {
    const data = applyRemove(sample(), "a");
    expect(data.children[ROOT]).toEqual(["b", "c"]);
    expect(data.nodes.a1).toBeUndefined();
    expect(data.children.a).toBeUndefined();
  });

  it("inserts a new page last under its parent", () => {
    const data = applyInsert(sample(), page("a3", "a"));
    expect(data.children.a).toEqual(["a1", "a2", "a3"]);
    expect(applyInsert(sample(), page("d", null)).children[ROOT]).toEqual(["a", "b", "c", "d"]);
  });

  it("detects no-op moves and cycles", () => {
    const data = sample();
    expect(isSameTarget(data, "b", { parentId: null, afterId: "a" })).toBe(true);
    expect(isSameTarget(data, "b", { parentId: null, afterId: null })).toBe(false);
    expect(isSelfOrAncestor(data, "a", "a2")).toBe(true);
    expect(isSelfOrAncestor(data, "b", "a2")).toBe(false);
  });
});

describe("keyboardMoveTarget", () => {
  it("moves up and down among siblings", () => {
    const data = sample();
    expect(keyboardMoveTarget(data, "c", "up")).toEqual({ parentId: null, afterId: "a" });
    expect(keyboardMoveTarget(data, "b", "up")).toEqual({ parentId: null, afterId: null });
    expect(keyboardMoveTarget(data, "a", "up")).toBeNull();
    expect(keyboardMoveTarget(data, "a", "down")).toEqual({ parentId: null, afterId: "b" });
    expect(keyboardMoveTarget(data, "c", "down")).toBeNull();
  });

  it("indents under the previous sibling and outdents after the parent", () => {
    const data = sample();
    expect(keyboardMoveTarget(data, "b", "indent")).toEqual({ parentId: "a", afterId: "a2" });
    expect(keyboardMoveTarget(data, "a", "indent")).toBeNull();
    expect(keyboardMoveTarget(data, "a2", "indent")).toEqual({ parentId: "a1", afterId: null });
    expect(keyboardMoveTarget(data, "a1", "outdent")).toEqual({ parentId: null, afterId: "a" });
    expect(keyboardMoveTarget(data, "b", "outdent")).toBeNull();
  });
});

describe("treeKeyAction", () => {
  const items = () => flattenTree(sample(), new Set(["a"]));

  it("moves focus with arrows, Home and End", () => {
    expect(treeKeyAction(items(), "a", "ArrowDown")).toEqual({ type: "focus", id: "a1" });
    expect(treeKeyAction(items(), "a1", "ArrowUp")).toEqual({ type: "focus", id: "a" });
    expect(treeKeyAction(items(), "a", "ArrowUp")).toBeNull();
    expect(treeKeyAction(items(), "b", "Home")).toEqual({ type: "focus", id: "a" });
    expect(treeKeyAction(items(), "a", "End")).toEqual({ type: "focus", id: "c" });
  });

  it("expands, enters, collapses and goes to the parent", () => {
    expect(treeKeyAction(items(), "c", "ArrowRight")).toEqual({ type: "expand", id: "c" });
    expect(treeKeyAction(items(), "a", "ArrowRight")).toEqual({ type: "focus", id: "a1" });
    expect(treeKeyAction(items(), "b", "ArrowRight")).toBeNull();
    expect(treeKeyAction(items(), "a", "ArrowLeft")).toEqual({ type: "collapse", id: "a" });
    expect(treeKeyAction(items(), "a2", "ArrowLeft")).toEqual({ type: "focus", id: "a" });
    expect(treeKeyAction(items(), "b", "ArrowLeft")).toBeNull();
    expect(treeKeyAction(items(), "b", "x")).toBeNull();
  });

  it("finds the next row by first letter, wrapping around", () => {
    const label = (id: string) =>
      ({ a: "Alpha", a1: "Anh", a2: "Bảng", b: "Beta", c: "Công" })[id]!;
    expect(typeaheadMatch(items(), "a", "b", label)).toBe("a2");
    expect(typeaheadMatch(items(), "a2", "b", label)).toBe("b");
    expect(typeaheadMatch(items(), "b", "a", label)).toBe("a");
    expect(typeaheadMatch(items(), "a", "z", label)).toBeNull();
  });
});

describe("expanded state storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("remembers expanded pages per Space", () => {
    saveExpanded(SPACE, ["a", "c"]);
    expect(loadExpanded(SPACE)).toEqual(["a", "c"]);
    expect(loadExpanded("other")).toEqual([]);
  });

  it("ignores broken data and unavailable storage", () => {
    window.localStorage.setItem(`kb.tree.expanded.${SPACE}`, "{not json");
    expect(loadExpanded(SPACE)).toEqual([]);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(loadExpanded(SPACE)).toEqual([]);
    expect(() => saveExpanded(SPACE, ["a"])).not.toThrow();
  });
});

describe("tree-href", () => {
  it("builds page links and reads the shortId back", () => {
    expect(pageHref("design", { slug: "huong-dan", shortId: "a1B2c3D4" })).toBe(
      "/s/design/p/huong-dan-a1B2c3D4",
    );
    expect(pageHref("design", { slug: "", shortId: "a1B2c3D4" })).toBe("/s/design/p/a1B2c3D4");
    expect(shortIdFromPathname("/s/design/p/huong-dan-a1B2c3D4", "design")).toBe("a1B2c3D4");
    expect(shortIdFromPathname("/s/design/p/a1B2c3D4/history", "design")).toBe("a1B2c3D4");
    expect(shortIdFromPathname("/s/design/settings", "design")).toBeNull();
    expect(shortIdFromPathname("/s/other/p/x-a1B2c3D4", "design")).toBeNull();
  });
});
