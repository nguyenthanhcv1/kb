import Link from "next/link";
import { useTranslations } from "next-intl";
import { Fragment } from "react";

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import type { PageSummary } from "@/server/pages";

import { pageHref } from "./tree-href";

type Crumb = Pick<PageSummary, "id" | "title" | "icon" | "slug" | "shortId">;

type PageBreadcrumbProps = {
  space: { slug: string; name: string };
  /** Root first, without the page itself — `listPageAncestors` / `listPageAncestorsAction`. */
  ancestors: readonly Crumb[];
  page: Pick<PageSummary, "title" | "icon">;
  /** Ancestors shown before collapsing the middle ones into "…" (first and last are kept). */
  maxAncestors?: number;
};

/** Visible ancestors: all of them, or the first and the last `maxAncestors - 1` with a gap. */
export function visibleCrumbs<T>(ancestors: readonly T[], maxAncestors: number) {
  if (ancestors.length <= maxAncestors || maxAncestors < 2) {
    return { head: ancestors.slice(), collapsed: false, tail: [] as T[] };
  }
  return {
    head: ancestors.slice(0, 1),
    collapsed: true,
    tail: ancestors.slice(ancestors.length - (maxAncestors - 1)),
  };
}

/**
 * Space › ancestors › page, for the page route (T2.4). Works in Server and Client Components.
 * Long chains collapse the middle into "…" so the bar stays on one or two lines at 360 px.
 */
export function PageBreadcrumb({ space, ancestors, page, maxAncestors = 3 }: PageBreadcrumbProps) {
  const t = useTranslations("tree");
  const { head, collapsed, tail } = visibleCrumbs(ancestors, maxAncestors);
  const crumb = (ancestor: Crumb) => (
    <Fragment key={ancestor.id}>
      <BreadcrumbSeparator />
      <BreadcrumbItem className="min-w-0">
        <BreadcrumbLink asChild className="max-w-40 truncate">
          <Link href={pageHref(space.slug, ancestor)}>
            {ancestor.icon && (
              <span aria-hidden className="me-1">
                {ancestor.icon}
              </span>
            )}
            {ancestor.title || t("untitled")}
          </Link>
        </BreadcrumbLink>
      </BreadcrumbItem>
    </Fragment>
  );

  return (
    <Breadcrumb aria-label={t("breadcrumb.label")}>
      <BreadcrumbList>
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbLink asChild className="max-w-40 truncate">
            <Link href={`/s/${space.slug}`}>{space.name}</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {head.map(crumb)}
        {collapsed && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbEllipsis label={t("breadcrumb.more")} className="size-5" />
            </BreadcrumbItem>
          </>
        )}
        {tail.map(crumb)}
        <BreadcrumbSeparator />
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbPage className="max-w-60 truncate">
            {page.icon && (
              <span aria-hidden className="me-1">
                {page.icon}
              </span>
            )}
            {page.title || t("untitled")}
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
