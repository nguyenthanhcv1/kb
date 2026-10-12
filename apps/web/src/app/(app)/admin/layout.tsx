import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { AdminForbidden } from "@/components/admin/admin-forbidden";
import { AdminNav } from "@/components/admin/admin-nav";

import { listPendingAccounts } from "@/server/admin/actions";

import { requireUser } from "../_lib/data";

/**
 * Frame of `/admin/*` (T1.7b): super admins only. Everyone else gets the "no access" state; the
 * pages render nothing for them and the server contract (`@/server/admin`) refuses them anyway
 * (`FORBIDDEN`, re-checked by Postgres).
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (!user.isSuperAdmin) return <AdminForbidden />;
  const [t, pending] = await Promise.all([
    getTranslations("admin"),
    listPendingAccounts({ status: "pending", limit: 1 }),
  ]);
  const pendingCount = pending.ok ? pending.data.total : 0;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <AdminNav pendingCount={pendingCount} />
      {children}
    </div>
  );
}
