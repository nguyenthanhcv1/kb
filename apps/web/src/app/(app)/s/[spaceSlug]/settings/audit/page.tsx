import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AuditActionFilter } from "@/components/audit/audit-action-filter";
import {
  auditPageHref,
  parseAuditCursor,
  parseSpaceAuditAction,
} from "@/components/audit/audit-entry";
import { AuditLogList } from "@/components/audit/audit-log-list";
import { canManageSpace } from "@/components/space/permissions";
import { Button } from "@/components/ui/button";
import { listAuditLogPage } from "@/server/audit/queries";

import { loadSpace } from "../../../../_lib/data";

type Props = {
  params: Promise<{ spaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const PAGE_SIZE = 50;

export async function generateMetadata() {
  const t = await getTranslations("audit");
  return { title: t("page.title") };
}

/**
 * Activity log of a Space (T1.6b): newest first, filter by action (`?action=`), keyset pages
 * (`?cursor=`). The layout renders the forbidden state for non-admins; RLS is the real check.
 */
export default async function SpaceAuditPage({ params, searchParams }: Props) {
  const [{ spaceSlug }, query] = await Promise.all([params, searchParams]);
  const space = await loadSpace(spaceSlug);
  if (!space) notFound();
  if (!canManageSpace(space.role)) return null;

  const t = await getTranslations();
  const base = `/s/${space.slug}/settings/audit`;
  const action = parseSpaceAuditAction(query.action);
  const cursor = parseAuditCursor(query.cursor);
  const result = await listAuditLogPage({
    spaceId: space.id,
    actions: action ? [action] : undefined,
    cursor: cursor ?? undefined,
    limit: PAGE_SIZE,
  });

  return (
    <section aria-labelledby="audit-title" className="flex flex-col gap-6">
      <div className="grid gap-1">
        <h2 id="audit-title" className="text-lg font-semibold">
          {t("audit.page.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("audit.page.description")}</p>
      </div>
      <AuditActionFilter key={action ?? ""} base={base} action={action} />

      {!result.ok ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-md bg-destructive/10 p-4 text-sm"
        >
          <p className="font-medium text-destructive">{t("audit.page.errorTitle")}</p>
          <p className="text-destructive">{t(`errors.${result.error}`)}</p>
          <Button asChild variant="outline" size="sm">
            <Link href={auditPageHref(base, { action })}>{t("audit.page.newest")}</Link>
          </Button>
        </div>
      ) : result.data.entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center">
          <p className="text-muted-foreground">
            {action ? t("audit.page.emptyFiltered") : t("audit.page.empty")}
          </p>
          {cursor ? (
            <Button asChild variant="outline" size="sm">
              <Link href={auditPageHref(base, { action })}>{t("audit.page.newest")}</Link>
            </Button>
          ) : (
            action && (
              <Button asChild variant="outline" size="sm">
                <Link href={base}>{t("audit.page.clearFilter")}</Link>
              </Button>
            )
          )}
        </div>
      ) : (
        <>
          <AuditLogList entries={result.data.entries} people={result.data.people} />
          {(cursor || result.data.nextCursor) && (
            <nav
              aria-label={t("audit.page.paginationLabel")}
              className="flex flex-wrap justify-between gap-2"
            >
              {cursor ? (
                <Button asChild variant="ghost" size="sm">
                  <Link href={auditPageHref(base, { action })}>{t("audit.page.newest")}</Link>
                </Button>
              ) : (
                <span />
              )}
              {result.data.nextCursor && (
                <Button asChild variant="outline" size="sm">
                  <Link href={auditPageHref(base, { action, cursor: result.data.nextCursor })}>
                    {t("audit.page.older")}
                  </Link>
                </Button>
              )}
            </nav>
          )}
        </>
      )}
    </section>
  );
}
