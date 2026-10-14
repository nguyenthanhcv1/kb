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
import { getMyPageRole } from "@/server/page-shares";
import type { SpaceRole } from "@/server/space";

import { loadSpace } from "./data";

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

/**
 * What the caller may do on a page and how to label its Space. `spaceRole` is `null` for someone
 * who reaches the page only through a page share (they see the Space name, not the Space);
 * `pageRole` is the Space role raised by page shares (`app.page_role`). `null` = no access.
 */
export type PageAccess = {
  spaceSlug: string;
  spaceName: string;
  spaceRole: SpaceRole | null;
  pageRole: SpaceRole | null;
};

export const loadPageAccess = cache(
  async (pageId: string, spaceSlug: string): Promise<PageAccess | null> => {
    const supabase = await createClient();
    const [space, pageRole] = await Promise.all([
      loadSpace(spaceSlug),
      getMyPageRole(supabase, { pageId }),
    ]);
    if (space) {
      return { spaceSlug: space.slug, spaceName: space.name, spaceRole: space.role, pageRole };
    }
    if (!pageRole) return null;
    // Shared page: `spaces_select` shows the name of a Space reached through a share.
    const { data } = await supabase
      .from("spaces")
      .select("slug, name")
      .eq("slug", spaceSlug)
      .maybeSingle();
    const row = data as { slug?: unknown; name?: unknown } | null;
    if (typeof row?.slug !== "string" || typeof row.name !== "string") return null;
    return { spaceSlug: row.slug, spaceName: row.name, spaceRole: null, pageRole };
  },
);
