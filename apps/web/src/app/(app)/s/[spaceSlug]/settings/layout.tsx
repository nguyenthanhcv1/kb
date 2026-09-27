import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { canManageSpace } from "@/components/space/permissions";
import { SpaceIcon } from "@/components/space/space-icon";
import { SpaceSettingsNav } from "@/components/space/space-settings-nav";
import { SpaceState } from "@/components/space/space-state";
import { Button } from "@/components/ui/button";

import { loadSpace } from "../../../_lib/data";

type Props = { children: ReactNode; params: Promise<{ spaceSlug: string }> };

/**
 * Frame of every Space settings section (general now; members T1.5b, audit log T1.6b): admin
 * gate, Space title, section tabs. Non-admins who can view the Space get a "forbidden" message;
 * everyone else the Space "not found" state.
 */
export default async function SpaceSettingsLayout({ children, params }: Props) {
  const space = await loadSpace((await params).spaceSlug);
  if (!space) notFound();
  const t = await getTranslations("space");

  if (!canManageSpace(space.role)) {
    return (
      <SpaceState
        title={t("forbidden.title")}
        description={t("forbidden.description")}
        actions={
          <Button asChild variant="outline">
            <Link href={`/s/${space.slug}`}>{t("settingsPage.backToSpace")}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3">
        <Link
          href={`/s/${space.slug}`}
          className="inline-flex items-center gap-1 self-start rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
          {t("settingsPage.backToSpace")}
        </Link>
        <div className="flex items-center gap-3">
          <SpaceIcon icon={space.icon} name={space.name} />
          <h1 className="min-w-0 text-2xl font-semibold break-words">
            {t("settings")}
            <span className="sr-only">: </span>
            <span className="block text-base font-normal text-muted-foreground">{space.name}</span>
          </h1>
        </div>
      </div>
      <SpaceSettingsNav slug={space.slug} />
      {children}
    </div>
  );
}
