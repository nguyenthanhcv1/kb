import { SettingsIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { spaceTrashHref } from "@/lib/page-href";
import type { Space } from "@/server/space";

import { canEditSpaceContent, canManageSpace } from "./permissions";
import { SpaceIcon } from "./space-icon";

/** Title block of a Space page: icon, name, visibility, description; settings link for admins. */
export function SpaceHeader({ space }: { space: Space }) {
  const t = useTranslations();
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <SpaceIcon icon={space.icon} name={space.name} size="lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold break-words">{space.name}</h1>
          <Badge variant="secondary">{t(`space.visibility.${space.visibility}`)}</Badge>
        </div>
        {space.description && (
          <p className="whitespace-pre-line text-muted-foreground">{space.description}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2 self-start">
        {canEditSpaceContent(space.role) && (
          <Button asChild variant="outline" size="sm">
            <Link href={spaceTrashHref(space.slug)}>
              <Trash2Icon aria-hidden />
              {t("nav.trash")}
            </Link>
          </Button>
        )}
        {canManageSpace(space.role) && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/s/${space.slug}/settings`}>
              <SettingsIcon aria-hidden />
              {t("space.settings")}
            </Link>
          </Button>
        )}
      </div>
    </header>
  );
}
