import Link from "next/link";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { SpaceSummary } from "@/server/space";

import { CreateSpaceDialog } from "./create-space-dialog";
import { SpaceIcon } from "./space-icon";

type SpaceListProps = {
  spaces: SpaceSummary[];
  /** Internal users only (`canCreateSpace`). */
  canCreate: boolean;
};

/** Spaces index: a card per visible Space (icon, name, description, visibility, the user's role). */
export function SpaceList({ spaces, canCreate }: SpaceListProps) {
  const t = useTranslations("space");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("list.description")}</p>
        </div>
        {canCreate && spaces.length > 0 && <CreateSpaceDialog />}
      </div>

      {spaces.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <p className="font-medium">{t("list.empty")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {canCreate ? t("list.emptyCreate") : t("list.emptyGuest")}
          </p>
          {canCreate && <CreateSpaceDialog />}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {spaces.map((space) => (
            <li key={space.id}>
              <Link
                href={`/s/${space.slug}`}
                className="flex h-full flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground shadow-xs transition-colors outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <div className="flex items-center gap-3">
                  <SpaceIcon icon={space.icon} name={space.name} />
                  <span className="min-w-0 truncate font-medium">{space.name}</span>
                </div>
                {space.description && (
                  <p className="line-clamp-2 text-sm text-muted-foreground">{space.description}</p>
                )}
                <div className="mt-auto flex flex-wrap gap-1.5">
                  <Badge variant="secondary">{t(`visibility.${space.visibility}`)}</Badge>
                  <Badge variant="outline">
                    {t("list.role", { role: t(`roles.${space.role}`) })}
                  </Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
