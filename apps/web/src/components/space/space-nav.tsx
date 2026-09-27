"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@/components/ui/utils";
import type { SpaceSummary } from "@/server/space";

import { CreateSpaceDialog } from "./create-space-dialog";
import { SpaceIcon } from "./space-icon";

type SpaceNavProps = {
  spaces: Pick<SpaceSummary, "id" | "slug" | "name" | "icon">[];
  /** Internal users only (`canCreateSpace`); guests never see the create button. */
  canCreate: boolean;
};

/** Whether `pathname` is the Space `slug` or one of its sub-pages. */
export function isSpacePath(pathname: string, slug: string): boolean {
  return pathname === `/s/${slug}` || pathname.startsWith(`/s/${slug}/`);
}

/**
 * Sidebar section listing the Spaces the user can view (links to `/s/<slug>`, current one
 * marked with `aria-current`), plus the create button for internal users. The page tree of the
 * current Space (T2.3) goes under its entry.
 */
export function SpaceNav({ spaces, canCreate }: SpaceNavProps) {
  const t = useTranslations("space");
  const pathname = usePathname();
  const headingId = "space-nav-heading";

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 px-2 pb-1">
        <h2 id={headingId} className="text-xs font-medium tracking-wide text-muted-foreground">
          <Link
            href="/"
            className="rounded-sm hover:text-sidebar-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {t("nav.heading")}
          </Link>
        </h2>
      </div>
      {spaces.length === 0 ? (
        <p className="px-2 text-sm text-muted-foreground">{t("list.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {spaces.map((space) => {
            const active = isSpacePath(pathname, space.slug);
            return (
              <li key={space.id}>
                <Link
                  href={`/s/${space.slug}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                  )}
                >
                  <SpaceIcon icon={space.icon} name={space.name} size="sm" />
                  <span className="truncate">{space.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {canCreate && (
        <CreateSpaceDialog
          triggerVariant="ghost"
          triggerSize="sm"
          triggerClassName="mt-1 justify-start px-2 text-muted-foreground"
        />
      )}
    </section>
  );
}
