import { getTranslations } from "next-intl/server";

import { BackToSpaceButton } from "@/components/page/back-to-space-button";
import { SpaceState } from "@/components/space/space-state";

/** Unknown page, or one the user cannot see (RLS does not reveal which, nor trashed pages). */
export default async function PageNotFound() {
  const t = await getTranslations();
  return (
    <SpaceState
      title={t("common.notFound.title")}
      description={t("errors.PAGE_NOT_FOUND")}
      actions={<BackToSpaceButton />}
    />
  );
}
