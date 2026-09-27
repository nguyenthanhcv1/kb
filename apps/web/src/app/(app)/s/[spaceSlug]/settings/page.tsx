import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ArchiveSpaceSection } from "@/components/space/archive-space-section";
import { canManageSpace } from "@/components/space/permissions";
import { SpaceSettingsForm } from "@/components/space/space-settings-form";

import { loadSpace } from "../../../_lib/data";

type Props = { params: Promise<{ spaceSlug: string }> };

export async function generateMetadata() {
  const t = await getTranslations("space");
  return { title: t("settings") };
}

/** General settings + archive. The layout renders the forbidden state for non-admins. */
export default async function SpaceSettingsPage({ params }: Props) {
  const space = await loadSpace((await params).spaceSlug);
  if (!space) notFound();
  if (!canManageSpace(space.role)) return null;
  return (
    <div className="flex flex-col gap-10">
      {/* Remount on save so the form starts from the saved values (e.g. a new slug). */}
      <SpaceSettingsForm key={space.updatedAt} space={space} />
      <ArchiveSpaceSection space={space} />
    </div>
  );
}
