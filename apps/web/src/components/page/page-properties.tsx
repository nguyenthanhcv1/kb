import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

import { pageHref } from "@/lib/page-href";
import type { PageSummary } from "@/server/pages";

type Related = Pick<PageSummary, "title" | "icon" | "slug" | "shortId">;

/**
 * "Page properties" card shown while editing: the Space, the parent page and the last update.
 * Read-only: moving a page stays in the sidebar tree and its menu.
 */
export function PageProperties({
  space,
  parent,
  lastEditedAt,
}: {
  space: { slug: string; name: string };
  /** Last entry of the page's ancestors; `null` for a top-level page. */
  parent: Related | null;
  lastEditedAt: string;
}) {
  const t = useTranslations("tree.page.properties");
  const tTree = useTranslations("tree");
  const format = useFormatter();

  return (
    <section
      aria-labelledby="page-properties-heading"
      className="flex flex-col gap-3 rounded-lg border bg-card p-4 text-sm"
    >
      <h2
        id="page-properties-heading"
        className="text-[11px] leading-4 font-semibold tracking-[0.08em] text-muted-foreground uppercase"
      >
        {t("title")}
      </h2>
      <dl className="flex flex-col gap-3">
        <Row label={t("space")}>
          <Link
            href={`/s/${encodeURIComponent(space.slug)}`}
            className="font-medium hover:underline"
          >
            {space.name}
          </Link>
        </Row>
        <Row label={t("parent")}>
          {parent ? (
            <Link href={pageHref(space.slug, parent)} className="font-medium hover:underline">
              {parent.title || tTree("untitled")}
            </Link>
          ) : (
            <span className="text-muted-foreground">{t("noParent")}</span>
          )}
        </Row>
        <Row label={t("updated")}>{format.dateTime(new Date(lastEditedAt), "dateTime")}</Row>
      </dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
