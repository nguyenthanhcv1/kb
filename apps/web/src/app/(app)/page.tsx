import { getTranslations } from "next-intl/server";

import { canCreateSpace } from "@/components/space/permissions";
import { SpaceList } from "@/components/space/space-list";

import { loadSpaces, requireUser } from "./_lib/data";

export async function generateMetadata() {
  const t = await getTranslations("space");
  return { title: t("title") };
}

/** Home: the Spaces the user can view (RLS filters them), with "Create space" for internal users. */
export default async function HomePage() {
  const user = await requireUser();
  const spaces = await loadSpaces();
  return <SpaceList spaces={spaces} canCreate={canCreateSpace(user)} />;
}
