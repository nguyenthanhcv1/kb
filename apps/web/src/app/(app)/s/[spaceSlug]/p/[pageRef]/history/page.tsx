import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { HistoryView, type DiffAgainst, type HistoryMode } from "@/components/history/history-view";
import { canEditSpaceContent } from "@/components/space/permissions";
import { createClient } from "@/lib/supabase/server";
import { canonicalPageRedirect, pageHref } from "@/lib/page-href";
import { getPageVersion, listPageVersions, VersionError } from "@/server/versions";

import { loadSpace } from "../../../../../_lib/data";
import { loadPageByRef, loadPageContent } from "../../../../../_lib/pages";

type Props = {
  params: Promise<{ spaceSlug: string; pageRef: string }>;
  searchParams: Promise<{ v?: string; mode?: string; against?: string }>;
};

export async function generateMetadata({ params }: Props) {
  const page = await loadPageByRef((await params).pageRef);
  const t = await getTranslations();
  return {
    title: page
      ? `${t("history.title")} · ${page.title || t("tree.untitled")}`
      : t("common.notFound.title"),
  };
}

/**
 * `/s/<space>/p/<ref>/history`: every role that can see the page can read its history (RLS on
 * `page_versions`). `?v=<versionNo>` selects a version (default: newest), `?mode=diff` compares it
 * `?against=previous|current`.
 */
export default async function PageHistoryRoute({ params, searchParams }: Props) {
  const { spaceSlug, pageRef } = await params;
  const query = await searchParams;
  const page = await loadPageByRef(pageRef);
  if (!page) notFound();

  const canonical = canonicalPageRedirect({ spaceSlug, ref: pageRef }, page);
  if (canonical) redirect(`${canonical}/history`);

  const space = await loadSpace(page.spaceSlug);
  if (!space) notFound();

  const supabase = await createClient();
  const versions = await listPageVersions(supabase, { pageId: page.id });

  const requestedNo = Number(query.v);
  const summary =
    versions.find((version) => version.versionNo === requestedNo) ?? versions[0] ?? null;
  const selected = summary
    ? await getPageVersion(supabase, { versionId: summary.id }).catch((error: unknown) => {
        if (error instanceof VersionError && error.code === "VERSION_NOT_FOUND") return null;
        throw error;
      })
    : null;

  const mode: HistoryMode = query.mode === "diff" ? "diff" : "preview";
  const hasPrevious = !!selected && versions.some((v) => v.versionNo < selected.versionNo);
  const against: DiffAgainst =
    query.against === "current" || (query.against !== "previous" && !hasPrevious)
      ? "current"
      : "previous";

  let compareWith = null;
  if (selected && mode === "diff") {
    if (against === "current") {
      compareWith = (await loadPageContent(page.id))?.contentJson ?? { type: "doc", content: [] };
    } else {
      const previous = versions.find((v) => v.versionNo < selected.versionNo);
      compareWith = previous
        ? (await getPageVersion(supabase, { versionId: previous.id })).contentJson
        : null;
    }
  }

  const href = pageHref(space.slug, page);
  return (
    <HistoryView
      key={page.id}
      pageId={page.id}
      canRestore={canEditSpaceContent(space.role)}
      pageHref={href}
      historyHref={`${href}/history`}
      pageTitle={page.title}
      versions={versions}
      selected={selected}
      mode={mode}
      against={against}
      compareWith={compareWith}
    />
  );
}
