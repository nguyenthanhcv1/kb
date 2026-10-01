"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@/components/ui/utils";

/** Sections of the Space settings: `{ segment: "members" }` → `/s/<slug>/settings/members`. */
export const SPACE_SETTINGS_SECTIONS = [
  { segment: "", label: "settingsPage.general" },
  { segment: "members", label: "members" },
  { segment: "audit", label: "settingsPage.audit" },
] as const;

export function SpaceSettingsNav({ slug }: { slug: string }) {
  const t = useTranslations("space");
  const pathname = usePathname();
  const base = `/s/${slug}/settings`;

  return (
    <nav aria-label={t("settingsPage.navLabel")} className="border-b">
      <ul className="-mb-px flex gap-4 overflow-x-auto">
        {SPACE_SETTINGS_SECTIONS.map((section) => {
          const href = section.segment ? `${base}/${section.segment}` : base;
          const active = pathname === href;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex border-b-2 border-transparent px-1 pb-2 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active && "border-primary text-foreground",
                )}
              >
                {t(section.label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
