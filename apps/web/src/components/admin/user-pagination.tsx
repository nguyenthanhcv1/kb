import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

import { USERS_PAGE_SIZE, usersHref, type UsersQuery } from "./users-query";

/** "1–50 of 120" with previous/next links; nothing when everything fits on one page. */
export function UserPagination({
  query,
  shown,
  total,
}: {
  query: UsersQuery;
  shown: number;
  total: number;
}) {
  const t = useTranslations("admin.users.pagination");
  if (total <= USERS_PAGE_SIZE && query.offset === 0) return null;

  const hasPrevious = query.offset > 0;
  const hasNext = query.offset + shown < total;
  const from = shown > 0 ? query.offset + 1 : 0;

  return (
    <nav aria-label={t("label")} className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground">
        {t("range", { from, to: query.offset + shown, total })}
      </span>
      <div className="flex gap-2">
        {hasPrevious ? (
          <Button asChild variant="outline" size="sm">
            <Link
              href={usersHref({ ...query, offset: Math.max(0, query.offset - USERS_PAGE_SIZE) })}
            >
              <ChevronLeftIcon aria-hidden />
              {t("previous")}
            </Link>
          </Button>
        ) : null}
        {hasNext ? (
          <Button asChild variant="outline" size="sm">
            <Link href={usersHref({ ...query, offset: query.offset + USERS_PAGE_SIZE })}>
              {t("next")}
              <ChevronRightIcon aria-hidden />
            </Link>
          </Button>
        ) : null}
      </div>
    </nav>
  );
}
