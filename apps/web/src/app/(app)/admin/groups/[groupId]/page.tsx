import { ChevronLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AdminForbidden } from "@/components/admin/admin-forbidden";
import { GroupDetail } from "@/components/admin/group-detail";
import { getGroup } from "@/server/admin/actions";

import { requireUser } from "../../../_lib/data";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ groupId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");
  return { title: t("groups.title") };
}

/** One group: details, members, add members, delete. */
export default async function AdminGroupPage({ params }: Props) {
  const user = await requireUser();
  // The layout renders the "no access" state.
  if (!user.isSuperAdmin) return null;
  const [{ groupId }, t] = await Promise.all([params, getTranslations("admin")]);
  const result = await getGroup({ groupId });
  if (!result.ok) {
    if (result.error === "FORBIDDEN") return <AdminForbidden />;
    if (result.error === "GROUP_NOT_FOUND" || result.error === "VALIDATION_FAILED") notFound();
    throw new Error(result.error);
  }
  const { group, members } = result.data;

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/admin/groups"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ChevronLeftIcon className="size-4" aria-hidden />
        {t("groups.back")}
      </Link>
      <h2 className="text-xl font-semibold break-words">{group.name}</h2>
      <GroupDetail
        key={`${group.id}:${group.name}:${group.description ?? ""}`}
        group={group}
        members={members}
      />
    </div>
  );
}
