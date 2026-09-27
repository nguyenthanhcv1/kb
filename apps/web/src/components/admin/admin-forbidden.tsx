import Link from "next/link";
import { useTranslations } from "next-intl";

import { SpaceState } from "@/components/space/space-state";
import { Button } from "@/components/ui/button";

/** Shown instead of `/admin/*` to signed-in users who are not (active) super admins. */
export function AdminForbidden() {
  const t = useTranslations();
  return (
    <SpaceState
      title={t("admin.forbidden.title")}
      description={t("admin.forbidden.description")}
      actions={
        <Button asChild variant="outline">
          <Link href="/">{t("common.notFound.backHome")}</Link>
        </Button>
      }
    />
  );
}
