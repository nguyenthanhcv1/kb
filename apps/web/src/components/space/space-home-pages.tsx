import { ChevronRightIcon, FileTextIcon } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

import { cn } from "@/components/ui/utils";
import { pageHref } from "@/lib/page-href";
import type { PageTreeNode } from "@/server/pages";

type SpaceHomePagesProps = {
  spaceSlug: string;
  /** Live root pages of the Space in tree order (`listChildPages` with `parentId: null`). */
  pages: PageTreeNode[];
  /** Editors and admins are pointed to "New page" in the sidebar when the Space is empty. */
  canEdit: boolean;
};

/**
 * Space landing page body: the root pages (icon, title, last edit) linking to each page, or an
 * empty state when the Space has none yet. The full tree stays in the sidebar (T2.3).
 */
export function SpaceHomePages({ spaceSlug, pages, canEdit }: SpaceHomePagesProps) {
  const t = useTranslations();
  const format = useFormatter();

  if (pages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="font-medium">{t("space.home.emptyTitle")}</p>
        <p className="text-sm text-muted-foreground">
          {canEdit ? t("space.home.emptyDescriptionEditor") : t("space.home.emptyDescription")}
        </p>
      </div>
    );
  }

  return (
    <section aria-labelledby="space-home-pages" className="flex flex-col gap-3">
      <h2 id="space-home-pages" className="text-lg font-semibold">
        {t("space.home.pagesHeading")}
      </h2>
      <ul className="divide-y rounded-lg border">
        {pages.map((page) => (
          <li key={page.id}>
            <Link
              href={pageHref(spaceSlug, page)}
              className="flex items-center gap-3 px-4 py-3 outline-none first:rounded-t-lg last:rounded-b-lg hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {page.icon ? (
                <span aria-hidden className="w-5 shrink-0 text-center text-lg leading-none">
                  {page.icon}
                </span>
              ) : (
                <FileTextIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span
                  className={cn("truncate font-medium", !page.title && "text-muted-foreground")}
                >
                  {page.title || t("tree.untitled")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("space.home.lastEdited", {
                    date: format.dateTime(new Date(page.lastEditedAt), "dateTime"),
                  })}
                </span>
              </span>
              {page.hasChildren && (
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                  {t("space.home.hasSubpages")}
                </span>
              )}
              <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
