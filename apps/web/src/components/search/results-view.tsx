import { FileTextIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { SearchHit } from "@/server/search/links";

import { searchErrorCode } from "./errors";
import { Snippet } from "./snippet";

export const RESULTS_PAGE_SIZE = 20;

export type ResultsViewProps = {
  query: string;
  spaceId: string;
  spaces: { id: string; name: string }[];
  page: number;
  hits: SearchHit[];
  hasNext: boolean;
  /** Error code of the search (`errors.<CODE>`), when it failed. */
  errorCode: string | null;
};

/** URL of the results page for the given filters. */
export function resultsHref(query: string, spaceId: string, page: number): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (spaceId) params.set("space", spaceId);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/search?${search}` : "/search";
}

/**
 * Full search results (T5.3): GET form (keyword + Space filter, works without JS), result list
 * with snippet, match location and "in table" label, previous/next pagination, and the empty and
 * error states.
 */
export function ResultsView({
  query,
  spaceId,
  spaces,
  page,
  hits,
  hasNext,
  errorCode,
}: ResultsViewProps) {
  const t = useTranslations("search");
  const tErrors = useTranslations("errors");
  const tTree = useTranslations("tree");
  const format = useFormatter();
  const shown = hits.slice(0, RESULTS_PAGE_SIZE);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          {query ? t("results.title") : t("results.intro.title")}
        </h1>
        {!query && <p className="text-muted-foreground">{t("results.intro.description")}</p>}
      </div>

      <form action="/search" method="get" role="search" className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            name="q"
            defaultValue={query}
            maxLength={200}
            autoComplete="off"
            aria-label={t("placeholder")}
            placeholder={t("placeholder")}
            className="pl-9"
          />
        </div>
        <NativeSelect
          name="space"
          defaultValue={spaceId}
          aria-label={t("results.filters.space")}
          className="w-full sm:w-52"
        >
          <option value="">{t("results.filters.allSpaces")}</option>
          {spaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit">{t("results.filters.submit")}</Button>
      </form>

      {errorCode && (
        <div role="alert" className="rounded-md border border-destructive/50 p-4">
          <p className="font-medium">{t("results.error.title")}</p>
          <p className="text-sm text-muted-foreground">{tErrors(searchErrorCode(errorCode))}</p>
        </div>
      )}

      {query && !errorCode && shown.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-8 text-center">
          <SearchIcon className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{t("results.empty.title", { query })}</p>
          <p className="text-sm text-muted-foreground">{t("results.empty.description")}</p>
        </div>
      )}

      {shown.length > 0 && (
        <section aria-label={t("results.title")} className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground" role="status">
            {t("results.count", { count: shown.length })}
            {page > 1 || hasNext ? ` · ${t("results.pagination.page", { page })}` : null}
          </p>
          <ul className="flex flex-col divide-y rounded-md border">
            {shown.map((hit) => (
              <li key={hit.pageId} className="p-4">
                <Link
                  href={hit.href}
                  className="flex flex-col gap-1 rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
                      {hit.icon ?? <FileTextIcon className="size-4 text-muted-foreground" />}
                    </span>
                    <span className="min-w-0 truncate">{hit.title || tTree("untitled")}</span>
                  </span>
                  {hit.snippetHtml && (
                    <Snippet
                      html={hit.snippetHtml}
                      className="line-clamp-3 text-sm text-muted-foreground"
                    />
                  )}
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground">
                    <span>{hit.spaceName}</span>
                    <Badge variant={hit.matchIn === "table" ? "secondary" : "outline"}>
                      {t(`matchIn.${hit.matchIn}`)}
                    </Badge>
                    <span>
                      {t("results.editedAt", {
                        date: format.dateTime(new Date(hit.lastEditedAt), "dateTime"),
                      })}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {(page > 1 || hasNext) && (
            <nav aria-label={t("results.pagination.label")} className="flex justify-between gap-2">
              {page > 1 ? (
                <Button asChild variant="outline">
                  <Link href={resultsHref(query, spaceId, page - 1)} rel="prev">
                    {t("results.pagination.previous")}
                  </Link>
                </Button>
              ) : (
                <span />
              )}
              {hasNext && (
                <Button asChild variant="outline">
                  <Link href={resultsHref(query, spaceId, page + 1)} rel="next">
                    {t("results.pagination.next")}
                  </Link>
                </Button>
              )}
            </nav>
          )}
        </section>
      )}
    </div>
  );
}
