"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@/components/ui/utils";

/** Sections of `/admin` (super admins only). */
export const ADMIN_SECTIONS = [
  { href: "/admin/access", label: "access.title" },
  { href: "/admin/users", label: "users.title" },
] as const;

export function AdminNav() {
  const t = useTranslations("admin");
  const pathname = usePathname();

  return (
    <nav aria-label={t("nav.label")} className="border-b">
      <ul className="-mb-px flex gap-4 overflow-x-auto">
        {ADMIN_SECTIONS.map((section) => {
          const active = pathname === section.href || pathname.startsWith(`${section.href}/`);
          return (
            <li key={section.href}>
              <Link
                href={section.href}
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
