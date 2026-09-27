import { SettingsIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Space } from "@/server/space";

import { canManageSpace } from "./permissions";
import { SpaceIcon } from "./space-icon";

/** Title block of a Space page: icon, name, visibility, description; settings link for admins. */
export function SpaceHeader({ space }: { space: Space }) {
  const t = useTranslations("space");
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <SpaceIcon icon={space.icon} name={space.name} size="lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold break-words">{space.name}</h1>
          <Badge variant="secondary">{t(`visibility.${space.visibility}`)}</Badge>
        </div>
        {space.description && (
          <p className="whitespace-pre-line text-muted-foreground">{space.description}</p>
        )}
      </div>
      {canManageSpace(space.role) && (
        <Button asChild variant="outline" size="sm" className="self-start">
          <Link href={`/s/${space.slug}/settings`}>
            <SettingsIcon aria-hidden />
            {t("settings")}
          </Link>
        </Button>
      )}
    </header>
  );
}
