import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { pageHref } from "@/lib/page-href";

import { SearchError, type SearchResult } from "./index";

/**
 * Link data for search results (task T5.3). `search_pages` returns ids only; the UI needs the
 * URL of the page and the Space it lives in. One extra read on `pages` (RLS applies) resolves
 * them for the whole result list.
 *
 * ```ts
 * await withPageLinks(supabase, results);
 * // [{ …result, href: "/s/design/p/quy-trinh-a1B2c3D4", spaceSlug: "design",
 * //    spaceName: "Design", icon: "📘" }]
 * ```
 */
export type SearchHit = SearchResult & {
  /** Canonical page URL. */
  href: string;
  spaceSlug: string;
  spaceName: string;
  icon: string | null;
};

const linkRowSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  short_id: z.string(),
  icon: z.string().nullable(),
  space: z.object({ slug: z.string(), name: z.string() }),
});

/** Adds `href`, Space slug/name and icon; results whose page is no longer readable are dropped. */
export async function withPageLinks(
  db: Pick<SupabaseClient, "from">,
  results: SearchResult[],
): Promise<SearchHit[]> {
  if (results.length === 0) return [];
  const { data, error } = await db
    .from("pages")
    .select("id, slug, short_id, icon, space:spaces!inner(slug, name)")
    .in(
      "id",
      results.map((result) => result.pageId),
    );
  if (error) throw new SearchError("SEARCH_FAILED", { cause: error });

  const rows = z.array(linkRowSchema).safeParse(data ?? []);
  if (!rows.success) throw new SearchError("SEARCH_FAILED", { cause: rows.error });
  const byId = new Map(rows.data.map((row) => [row.id, row]));

  return results.flatMap((result) => {
    const row = byId.get(result.pageId);
    if (!row) return [];
    return [
      {
        ...result,
        href: pageHref(row.space.slug, { slug: row.slug, shortId: row.short_id }),
        spaceSlug: row.space.slug,
        spaceName: row.space.name,
        icon: row.icon,
      },
    ];
  });
}
