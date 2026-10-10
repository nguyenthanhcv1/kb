import { cache } from "react";

import { parsePageRef } from "@/lib/page-href";
import { createClient } from "@/lib/supabase/server";
import {
  getPageByShortId,
  getPageContent,
  listChildPages,
  listPageAncestors,
  listRecentPages,
  listTrash,
} from "@/server/pages";

/**
 * Per-request cached page reads for the `/s/[spaceSlug]` home, `/s/[spaceSlug]/p/[pageRef]` and
 * `/s/[spaceSlug]/trash` routes (React `cache` dedupes `generateMetadata` + page). RLS decides visibility.
 */

/** Page of a `[pageRef]` segment (any slug, looked up by short id), or `null`. */
export const loadPageByRef = cache(async (ref: string) => {
  const parts = parsePageRef(ref);
  if (!parts) return null;
  return getPageByShortId(await createClient(), { shortId: parts.shortId });
});

export const loadPageContent = cache(async (pageId: string) =>
  getPageContent(await createClient(), { pageId }),
);

export const loadTrash = cache(async (spaceId: string) =>
  listTrash(await createClient(), { spaceId }),
);

/** Live root pages of a Space in tree order (Space home). */
export const loadRootPages = cache(async (spaceId: string) =>
  listChildPages(await createClient(), { spaceId, parentId: null }),
);

/** Pages edited most recently across the user's Spaces; empty on a read error (home still renders). */
export const loadRecentPages = cache(async () => {
  try {
    return await listRecentPages(await createClient(), { limit: 8 });
  } catch (error) {
    console.error("[pages] listRecentPages failed", error);
    return [];
  }
});

/** Ancestors of a page, root first; empty on a read error (the breadcrumb then shows Space › page). */
export const loadPageAncestors = cache(async (pageId: string) => {
  try {
    return await listPageAncestors(await createClient(), { pageId });
  } catch (error) {
    console.error("[pages] listPageAncestors failed", error);
    return [];
  }
});
