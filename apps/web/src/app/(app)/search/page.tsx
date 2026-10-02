import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { RESULTS_PAGE_SIZE, ResultsView } from "@/components/search/results-view";
import { createClient } from "@/lib/supabase/server";
import { SearchError, SEARCH_MAX_QUERY_LENGTH, searchPages } from "@/server/search";
import { withPageLinks, type SearchHit } from "@/server/search/links";

import { loadSpaces } from "../_lib/data";

type Props = { searchParams: Promise<{ q?: string; space?: string; page?: string }> };

export async function generateMetadata() {
  const t = await getTranslations("search");
  return { title: t("results.title") };
}

/**
 * `/search?q=<keywords>&space=<uuid>&page=<n>`: full results of `search_pages` (T5.2), RLS limits
 * them to Spaces the user can view. One extra row is requested to know whether a next page exists.
 */
export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = (params.q ?? "").trim().slice(0, SEARCH_MAX_QUERY_LENGTH);
  const spaces = await loadSpaces();
  const requestedSpace = z.uuid().safeParse(params.space).data ?? "";
  const spaceId = spaces.some((space) => space.id === requestedSpace) ? requestedSpace : "";
  const pageNo = Math.min(Math.max(Math.trunc(Number(params.page)) || 1, 1), 500);

  let hits: SearchHit[] = [];
  let errorCode: string | null = null;
  let hasNext = false;
  if (query) {
    try {
      const supabase = await createClient();
      const output = await searchPages(supabase, {
        q: query,
        spaceIds: spaceId ? [spaceId] : undefined,
        limit: RESULTS_PAGE_SIZE + 1,
        offset: (pageNo - 1) * RESULTS_PAGE_SIZE,
      });
      hasNext = output.results.length > RESULTS_PAGE_SIZE;
      hits = (await withPageLinks(supabase, output.results)).slice(0, RESULTS_PAGE_SIZE);
    } catch (error) {
      errorCode = error instanceof SearchError ? error.code : "SEARCH_FAILED";
      if (!(error instanceof SearchError)) console.error("[search] page failed", error);
    }
  }

  return (
    <ResultsView
      query={query}
      spaceId={spaceId}
      spaces={spaces.map((space) => ({ id: space.id, name: space.name }))}
      page={pageNo}
      hits={hits}
      hasNext={hasNext}
      errorCode={errorCode}
    />
  );
}
