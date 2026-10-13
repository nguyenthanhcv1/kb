import Link from "next/link";
import { useTranslations } from "next-intl";

import { cn } from "@/components/ui/utils";
import { ACCOUNT_REVIEW_STATUSES } from "@/server/admin";

import { approvalsHref, type ApprovalsQuery } from "./approvals-query";

/** "Waiting / Rejected" switch of `/admin/approvals`; changing it resets the page offset. */
export function ApprovalFilters({ query }: { query: ApprovalsQuery }) {
  const t = useTranslations("admin.approvals");

  return (
    <nav aria-label={t("status.label")}>
      <ul className="inline-flex gap-1 rounded-lg bg-muted p-1">
        {ACCOUNT_REVIEW_STATUSES.map((status) => {
          const active = status === query.status;
          return (
            <li key={status}>
              <Link
                href={approvalsHref({ status, offset: 0 })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex rounded-md px-3 py-1 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active && "bg-background text-foreground shadow-xs",
                )}
              >
                {t(`status.${status}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
