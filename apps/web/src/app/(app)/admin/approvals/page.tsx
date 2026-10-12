import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AdminForbidden } from "@/components/admin/admin-forbidden";
import { ApprovalFilters } from "@/components/admin/approval-filters";
import { ApprovalPagination } from "@/components/admin/approval-pagination";
import {
  APPROVALS_PAGE_SIZE,
  parseApprovalsSearchParams,
} from "@/components/admin/approvals-query";
import { PendingAccountList } from "@/components/admin/pending-account-list";
import { listPendingAccounts } from "@/server/admin/actions";

import { requireUser } from "../../_lib/data";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");
  return { title: t("approvals.title") };
}

/** New accounts waiting for a super admin (and the rejected ones): approve as internal/guest, or reject. */
export default async function AdminApprovalsPage({ searchParams }: Props) {
  const user = await requireUser();
  // The layout renders the "no access" state.
  if (!user.isSuperAdmin) return null;
  const query = parseApprovalsSearchParams(await searchParams);
  const [t, result] = await Promise.all([
    getTranslations("admin"),
    listPendingAccounts({
      status: query.status,
      limit: APPROVALS_PAGE_SIZE,
      offset: query.offset,
    }),
  ]);
  if (!result.ok) {
    if (result.error === "FORBIDDEN") return <AdminForbidden />;
    throw new Error(result.error);
  }
  const { accounts, total } = result.data;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground">{t("approvals.description")}</p>
      <ApprovalFilters query={query} />
      <p className="text-sm text-muted-foreground">{t("approvals.count", { count: total })}</p>
      <PendingAccountList accounts={accounts} />
      <ApprovalPagination query={query} shown={accounts.length} total={total} />
    </div>
  );
}
