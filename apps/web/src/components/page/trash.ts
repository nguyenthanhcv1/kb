import type { PageSummary } from "@/server/pages";

/** One row of the Space trash. */
export type TrashEntry = {
  page: PageSummary;
  /** Descendants trashed together with it (restored and deleted with it). */
  subpageCount: number;
  /**
   * The parent is in the trash too, trashed at another time: restoring this page alone puts it
   * at the root of the Space (see `restorePage`).
   */
  parentInTrash: boolean;
};

/**
 * Groups `listTrash` rows into what the user trashed: a subtree trashed in one action shares the
 * same `deletedAt` (T2.1 cascade), so its descendants are folded into the top page's entry.
 * Keeps the input order (newest first).
 */
export function groupTrash(pages: readonly PageSummary[]): TrashEntry[] {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const trashedWithParent = (page: PageSummary) => {
    const parent = page.parentId ? byId.get(page.parentId) : undefined;
    return parent !== undefined && parent.deletedAt === page.deletedAt ? parent : undefined;
  };

  const counts = new Map<string, number>();
  for (const page of pages) {
    let top = trashedWithParent(page);
    if (!top) continue;
    const seen = new Set([page.id]);
    // Walk up to the page the user actually trashed (the guard stops on corrupt cycles).
    for (let up = trashedWithParent(top); up && !seen.has(up.id); up = trashedWithParent(up)) {
      seen.add(top.id);
      top = up;
    }
    counts.set(top.id, (counts.get(top.id) ?? 0) + 1);
  }

  return pages
    .filter((page) => !trashedWithParent(page))
    .map((page) => ({
      page,
      subpageCount: counts.get(page.id) ?? 0,
      parentInTrash: page.parentId !== null && byId.has(page.parentId),
    }));
}
