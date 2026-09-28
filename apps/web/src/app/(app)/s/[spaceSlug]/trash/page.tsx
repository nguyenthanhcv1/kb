import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { TrashList } from "@/components/page/trash-list";
import { canEditSpaceContent, canManageSpace } from "@/components/space/permissions";
import { SpaceState } from "@/components/space/space-state";
import { Button } from "@/components/ui/button";

import { loadSpace } from "../../../_lib/data";
import { loadTrash } from "../../../_lib/pages";

type Props = { params: Promise<{ spaceSlug: string }> };

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("trash") };
}

/**
 * Trash of a Space: editors and admins restore pages (back to their former place), admins also
 * delete them for good. Viewers get a "forbidden" message (RLS would show them nothing anyway).
 */
export default async function SpaceTrashPage({ params }: Props) {
  const space = await loadSpace((await params).spaceSlug);
  if (!space) notFound();
  const t = await getTranslations();
  const backLink = `/s/${space.slug}`;

  if (!canEditSpaceContent(space.role)) {
    return (
      <SpaceState
        title={t("tree.trash.forbidden.title")}
        description={t("tree.trash.forbidden.description")}
        actions={
          <Button asChild variant="outline">
            <Link href={backLink}>{t("space.settingsPage.backToSpace")}</Link>
          </Button>
        }
      />
    );
  }

  const pages = await loadTrash(space.id);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3">
        <Link
          href={backLink}
          className="inline-flex items-center gap-1 self-start rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
          {t("space.settingsPage.backToSpace")}
        </Link>
        <h1 className="text-2xl font-semibold">{t("nav.trash")}</h1>
        <p className="text-muted-foreground">
          {t("tree.trash.description", { space: space.name })}
        </p>
      </div>
      <TrashList spaceSlug={space.slug} pages={pages} canPurge={canManageSpace(space.role)} />
    </div>
  );
}
