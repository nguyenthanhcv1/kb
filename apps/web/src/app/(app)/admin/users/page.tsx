import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AdminForbidden } from "@/components/admin/admin-forbidden";
import { UserFilters } from "@/components/admin/user-filters";
import { UserList } from "@/components/admin/user-list";
import { UserPagination } from "@/components/admin/user-pagination";
import { USERS_PAGE_SIZE, parseUsersSearchParams } from "@/components/admin/users-query";
import { listUsers } from "@/server/admin/actions";

import { requireUser } from "../../_lib/data";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");
  return { title: t("users.title") };
}

/** Every user (guests included), searchable, with lock/unlock and grant/revoke super admin. */
export default async function AdminUsersPage({ searchParams }: Props) {
  const user = await requireUser();
  // The layout renders the "no access" state.
  if (!user.isSuperAdmin) return null;
  const query = parseUsersSearchParams(await searchParams);
  const [t, result] = await Promise.all([
    getTranslations("admin"),
    listUsers({
      query: query.query || undefined,
      status: query.status,
      limit: USERS_PAGE_SIZE,
      offset: query.offset,
    }),
  ]);
  if (!result.ok) {
    if (result.error === "FORBIDDEN") return <AdminForbidden />;
    throw new Error(result.error);
  }
  const { users, total } = result.data;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground">{t("users.description")}</p>
      <UserFilters query={query} />
      <p className="text-sm text-muted-foreground">{t("users.count", { count: total })}</p>
      <UserList users={users} />
      <UserPagination query={query} shown={users.length} total={total} />
    </div>
  );
}
