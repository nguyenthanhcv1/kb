import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

import { pageHref } from "@/lib/page-href";
import type { RecentPage } from "@/server/pages";

import { SpaceIcon } from "./space-icon";

/** "Recently updated" list of the home page: page, its Space and when it was last edited. */
export function RecentPages({ pages }: { pages: RecentPage[] }) {
  const t = useTranslations("space.dashboard");
  const tTree = useTranslations("tree");
  const format = useFormatter();

  return (
    <section aria-labelledby="home-recent-heading" className="flex flex-col gap-3.5">
      <h2 id="home-recent-heading" className="text-xl leading-7 font-bold">
        {t("recentTitle")}
      </h2>
      {pages.length === 0 ? (
        <p className="rounded-[10px] border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("recentEmpty")}
        </p>
      ) : (
        <ul className="overflow-hidden rounded-[10px] border bg-card">
          {pages.map((page) => (
            <li key={page.id} className="border-b last:border-b-0">
              <Link
                href={pageHref(page.spaceSlug, page)}
                className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3.5 outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                <span className="flex min-w-0 flex-1 basis-72 items-center gap-2.5">
                  <span aria-hidden className="w-5 shrink-0 text-center text-base">
                    {page.icon ?? "📄"}
                  </span>
                  <span className="truncate text-[15px] font-medium">
                    {page.title || tTree("untitled")}
                  </span>
                </span>
                <span className="flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground">
                  <SpaceIcon
                    icon={page.spaceIcon}
                    name={page.spaceName}
                    size="sm"
                    className="size-4 bg-transparent text-xs text-accent-foreground"
                  />
                  <span className="max-w-40 truncate">{page.spaceName}</span>
                </span>
                <span className="min-w-40 text-right text-[13px] text-muted-foreground">
                  {t("recentUpdated", {
                    date: format.dateTime(new Date(page.lastEditedAt), "dateTime"),
                  })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
