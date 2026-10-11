"use client";

import { HomeIcon, SearchIcon, SparklesIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@/components/ui/utils";

type Item = { href: string; label: "home" | "search" | "whatsNew"; icon: LucideIcon };

const ITEMS: readonly Item[] = [
  { href: "/", label: "home", icon: HomeIcon },
  { href: "/search", label: "search", icon: SearchIcon },
  { href: "/whats-new", label: "whatsNew", icon: SparklesIcon },
];

/** Whether `pathname` is `href` itself (Home matches only `/`) or a page below it. */
export function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Home, Search and What's new at the top of the sidebar; the current one is marked `aria-current`. */
export function MainNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-0.5">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActivePath(pathname, href);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-sidebar-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
                active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-[18px] shrink-0" aria-hidden />
              {t(label)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
