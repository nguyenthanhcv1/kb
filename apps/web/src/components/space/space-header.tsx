import { SettingsIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Space } from "@/server/space";

import { canManageSpace } from "./permissions";
import { SpaceIcon } from "./space-icon";

/**
 * Title block of a Space page: icon, name, visibility, description; settings link for admins and
 * optional extra `actions` (e.g. "leave space" for members, T1.5b).
 */
export function SpaceHeader({ space, actions }: { space: Space; actions?: ReactNode }) {
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
      {(canManageSpace(space.role) || actions) && (
        <div className="flex flex-wrap gap-2 self-start">
          {canManageSpace(space.role) && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/s/${space.slug}/settings`}>
                <SettingsIcon aria-hidden />
                {t("settings")}
              </Link>
            </Button>
          )}
          {actions}
        </div>
      )}
    </header>
  );
}
