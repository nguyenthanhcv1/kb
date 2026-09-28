import type { PageErrorCode, PageSummary, PageTreeNode } from "@/server/pages";
import { comparePositions, keyBetween } from "@/server/pages/position";

import type { PageTreeApi } from "./tree-api";

/** Seed row for {@link createMemoryPageTreeApi}: siblings keep the array order. */
export type SeedPage = { id: string; parentId: string | null; title: string; icon?: string | null };

type Options = {
  /** Code returned by the next call of an operation instead of performing it. */
  failNext?: Partial<Record<keyof PageTreeApi, PageErrorCode>>;
};

/**
 * In-memory {@link PageTreeApi} for component tests (and local previews): same ordering rules as
 * the server (fractional positions, `afterId` null = first / omitted = last). Test-only.
 */
export function createMemoryPageTreeApi(spaceId: string, seed: SeedPage[], options: Options = {}) {
  const pages = new Map<string, PageSummary>();
  let counter = 0;
  const shortId = () => `p${String(++counter).padStart(7, "0")}`;
  const slugOf = (title: string) =>
    title
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/g, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  const children = (parentId: string | null) =>
    [...pages.values()]
      .filter((page) => page.parentId === parentId && !page.deletedAt)
      .sort((a, b) => comparePositions(a.position, b.position));

  const positionFor = (
    parentId: string | null,
    afterId: string | null | undefined,
    id?: string,
  ) => {
    const siblings = children(parentId).filter((page) => page.id !== id);
    if (afterId === undefined) return keyBetween(siblings.at(-1)?.position ?? null, null);
    if (afterId === null) return keyBetween(null, siblings[0]?.position ?? null);
    const index = siblings.findIndex((page) => page.id === afterId);
    return keyBetween(siblings[index]!.position, siblings[index + 1]?.position ?? null);
  };

  const add = (id: string, parentId: string | null, title: string, icon: string | null = null) => {
    const page: PageSummary = {
      id,
      spaceId,
      parentId,
      shortId: shortId(),
      slug: slugOf(title),
      title,
      icon,
      position: positionFor(parentId, undefined),
      lastEditedAt: "2026-09-26T09:00:00+00:00",
      deletedAt: null,
    };
    pages.set(id, page);
    return page;
  };
  for (const row of seed) add(row.id, row.parentId, row.title, row.icon ?? null);

  const failNext = { ...options.failNext };
  const fail = (op: keyof PageTreeApi) => {
    const code = failNext[op];
    if (!code) return null;
    delete failNext[op];
    return { ok: false as const, code };
  };
  const ok = <T>(data: T) => ({ ok: true as const, data });
  const trashSubtree = (id: string, at: string | null) => {
    pages.set(id, { ...pages.get(id)!, deletedAt: at });
    for (const child of [...pages.values()].filter((page) => page.parentId === id)) {
      trashSubtree(child.id, at);
    }
  };

  const api: PageTreeApi = {
    async listChildren({ parentId }) {
      const failed = fail("listChildren");
      if (failed) return failed;
      const list = children(parentId ?? null).map((page): PageTreeNode => ({
        ...page,
        hasChildren: children(page.id).length > 0,
      }));
      return ok(list);
    },
    async create({ parentId = null, title = "" }) {
      const failed = fail("create");
      return failed ?? ok(add(`new-${counter + 1}`, parentId, title));
    },
    async rename({ pageId, title }) {
      const failed = fail("rename");
      if (failed) return failed;
      const page = { ...pages.get(pageId)!, title, slug: slugOf(title) };
      pages.set(pageId, page);
      return ok(page);
    },
    async move({ pageId, parentId, afterId }) {
      const failed = fail("move");
      if (failed) return failed;
      const page = {
        ...pages.get(pageId)!,
        parentId,
        position: positionFor(parentId, afterId, pageId),
      };
      pages.set(pageId, page);
      return ok(page);
    },
    async trash({ pageId }) {
      const failed = fail("trash");
      if (failed) return failed;
      trashSubtree(pageId, "2026-09-27T09:00:00+00:00");
      return ok(pages.get(pageId)!);
    },
  };

  return {
    api,
    /** Titles of the live children of `parentId`, in order. */
    titles: (parentId: string | null) => children(parentId).map((page) => page.title),
    page: (id: string) => pages.get(id),
    failNext: (op: keyof PageTreeApi, code: PageErrorCode) => {
      failNext[op] = code;
    },
  };
}
