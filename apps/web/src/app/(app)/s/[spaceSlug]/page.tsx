import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { SpaceHeader } from "@/components/space/space-header";

import { loadSpace } from "../../_lib/data";

type Props = { params: Promise<{ spaceSlug: string }> };

export async function generateMetadata({ params }: Props) {
  const space = await loadSpace((await params).spaceSlug);
  const t = await getTranslations("space");
  return { title: space?.name ?? t("notFound.title") };
}

/** Space landing page. The page tree and pages of the Space arrive with T2.3 / T2.4. */
export default async function SpacePage({ params }: Props) {
  const space = await loadSpace((await params).spaceSlug);
  if (!space) notFound();
  const t = await getTranslations("space.home");
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-4 sm:p-6">
      <SpaceHeader space={space} />
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="font-medium">{t("emptyTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("emptyDescription")}</p>
      </div>
    </div>
  );
}
