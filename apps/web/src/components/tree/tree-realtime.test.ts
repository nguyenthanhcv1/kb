import { describe, expect, it } from "vitest";

import type { PageSummary, PageTreeNode } from "@/server/pages";

import { applyChildren, applyRemote, EMPTY_TREE, ROOT, type TreeData } from "./tree-model";
import { pageFromRow } from "./tree-realtime";

const page = (id: string, parentId: string | null, position: string, extra = {}): PageSummary => ({
  id,
  spaceId: "s",
  parentId,
  shortId: id.padEnd(8, "0"),
  slug: id,
  title: id,
  icon: null,
  position,
  lastEditedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
  ...extra,
});
const node = (p: PageSummary, hasChildren = false): PageTreeNode => ({ ...p, hasChildren });

const base = (): TreeData =>
  applyChildren(
    applyChildren(EMPTY_TREE, null, [
      node(page("a", null, "a0"), true),
      node(page("c", null, "c0")),
    ]),
    "a",
    [node(page("a1", "a", "a0"))],
  );

describe("applyRemote", () => {
  it("inserts a new page in position order", () => {
    const next = applyRemote(base(), page("b", null, "b0"));
    expect(next.children[ROOT]).toEqual(["a", "b", "c"]);
  });

  it("is idempotent for a change we already have", () => {
    const data = base();
    expect(applyRemote(data, page("c", null, "c0"))).toBe(data);
  });

  it("applies renames without touching the order", () => {
    const next = applyRemote(base(), page("c", null, "c0", { title: "New" }));
    expect(next.nodes.c?.title).toBe("New");
    expect(next.children[ROOT]).toEqual(["a", "c"]);
  });

  it("moves a page to another loaded level", () => {
    const next = applyRemote(base(), page("c", "a", "a1"));
    expect(next.children[ROOT]).toEqual(["a"]);
    expect(next.children.a).toEqual(["a1", "c"]);
  });

  it("removes trashed pages", () => {
    const next = applyRemote(base(), page("c", null, "c0", { deletedAt: "2026-01-02T00:00:00Z" }));
    expect(next.children[ROOT]).toEqual(["a"]);
    expect(next.nodes.c).toBeUndefined();
  });

  it("marks a parent whose level is not loaded as having children", () => {
    const data = applyChildren(EMPTY_TREE, null, [node(page("a", null, "a0"), true)]);
    const next = applyRemote(data, page("x", "a", "a0"));
    expect(next.nodes.a?.hasChildren).toBe(true);
    expect(next.nodes.x).toBeUndefined();
  });

  it("ignores pages under a parent the tree does not know", () => {
    const data = base();
    expect(applyRemote(data, page("x", "zzz", "a0"))).toBe(data);
  });
});

describe("pageFromRow", () => {
  it("maps a Realtime row", () => {
    expect(
      pageFromRow({
        id: "i",
        space_id: "s",
        parent_id: null,
        short_id: "abcdefgh",
        slug: "x",
        title: "T",
        icon: null,
        position: "a0",
        last_edited_at: "2026-01-01T00:00:00Z",
        deleted_at: null,
      }),
    ).toMatchObject({ id: "i", spaceId: "s", parentId: null, title: "T" });
  });

  it("rejects partial rows", () => {
    expect(pageFromRow({ id: "i" })).toBeNull();
  });
});
