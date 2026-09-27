import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { SpaceState } from "@/components/space/space-state";
import { Button } from "@/components/ui/button";

/** Unknown, archived or not-visible Space: one message for all (RLS does not reveal which). */
export default async function SpaceNotFound() {
  const t = await getTranslations();
  return (
    <SpaceState
      title={t("space.notFound.title")}
      description={t("errors.SPACE_NOT_FOUND")}
      actions={
        <Button asChild>
          <Link href="/">{t("space.notFound.backToList")}</Link>
        </Button>
      }
    />
  );
}
