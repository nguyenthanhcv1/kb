import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Brand } from "./brand";
import { MainNav } from "./main-nav";

/**
 * Sidebar frame: brand on top, the main links (Home, Search, What's new), then the navigation
 * passed by the page (Space list and page tree). Empty → a placeholder text.
 * With `version`, a footer shows the running release and links to What's new.
 */
export function Sidebar({ children, version }: { children?: ReactNode; version?: string }) {
  const t = useTranslations("common.shell");
  return (
    <div data-slot="sidebar" className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 shrink-0 items-center px-4">
        <Brand showTagline />
      </div>
      <nav
        aria-label={t("mainNavigation")}
        className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 pb-4"
      >
        <MainNav />
        {children ?? <p className="text-sm text-muted-foreground">{t("sidebarEmpty")}</p>}
      </nav>
      {version && (
        <div className="shrink-0 border-t border-sidebar-border px-4 py-2">
          <Link
            href="/whats-new"
            aria-label={t("versionLink", { version })}
            className="rounded-sm font-mono text-xs text-muted-foreground hover:text-sidebar-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {t("version", { version })}
          </Link>
        </div>
      )}
    </div>
  );
}
