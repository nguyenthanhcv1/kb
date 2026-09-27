import { SearchIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/components/ui/utils";
import { USER_STATUS_FILTERS } from "@/server/admin";

import { usersHref, type UsersQuery } from "./users-query";

/**
 * Search (a plain GET form, works without JavaScript) and status filter links of `/admin/users`.
 * Both reset the page offset.
 */
export function UserFilters({ query }: { query: UsersQuery }) {
  const t = useTranslations("admin.users");

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <form action="/admin/users" method="get" role="search" className="flex gap-2 sm:max-w-sm">
        {query.status !== "all" && <input type="hidden" name="status" value={query.status} />}
        <Input
          type="search"
          name="q"
          defaultValue={query.query}
          aria-label={t("search.label")}
          placeholder={t("search.label")}
          maxLength={200}
        />
        <Button type="submit" variant="outline" size="icon" aria-label={t("search.submit")}>
          <SearchIcon aria-hidden />
        </Button>
      </form>
      <nav aria-label={t("status.label")}>
        <ul className="flex gap-1 rounded-lg bg-muted p-1">
          {USER_STATUS_FILTERS.map((status) => {
            const active = status === query.status;
            return (
              <li key={status}>
                <Link
                  href={usersHref({ ...query, status, offset: 0 })}
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
    </div>
  );
}
