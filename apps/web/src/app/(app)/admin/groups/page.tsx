import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AdminForbidden } from "@/components/admin/admin-forbidden";
import { GroupList } from "@/components/admin/group-list";
import { listGroups } from "@/server/admin/actions";

import { requireUser } from "../../_lib/data";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");
  return { title: t("groups.title") };
}

/** Groups of people (a team and its members); granting a group access to a Space follows later. */
export default async function AdminGroupsPage() {
  const user = await requireUser();
  // The layout renders the "no access" state.
  if (!user.isSuperAdmin) return null;
  const [t, result] = await Promise.all([getTranslations("admin"), listGroups()]);
  if (!result.ok) {
    if (result.error === "FORBIDDEN") return <AdminForbidden />;
    throw new Error(result.error);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground">{t("groups.description")}</p>
      <GroupList groups={result.data.groups} />
    </div>
  );
}
