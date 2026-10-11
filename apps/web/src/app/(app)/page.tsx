import { getTranslations } from "next-intl/server";

import { canCreateSpace } from "@/components/space/permissions";
import { HomeView } from "@/components/space/home-view";

import { loadSpaces, requireUser } from "./_lib/data";
import { loadRecentPages } from "./_lib/pages";

export async function generateMetadata() {
  const t = await getTranslations("space");
  return { title: t("title") };
}

/**
 * Home: search, the Spaces the user can view and the pages edited most recently (RLS filters
 * all of them), with "Create space" for internal users.
 */
export default async function HomePage() {
  const user = await requireUser();
  const [spaces, recent] = await Promise.all([loadSpaces(), loadRecentPages()]);
  return <HomeView spaces={spaces} recent={recent} canCreate={canCreateSpace(user)} />;
}
