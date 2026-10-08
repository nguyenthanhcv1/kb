import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Brand } from "./brand";

/**
 * Sidebar frame: brand on top, then the navigation passed by the page
 * (Space list and page tree arrive with T1.4b / T2.3). Empty → a placeholder text.
 * With `version`, a footer shows the running release and links to What's new.
 */
export function Sidebar({ children, version }: { children?: ReactNode; version?: string }) {
  const t = useTranslations("common.shell");
  return (
    <div data-slot="sidebar" className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 shrink-0 items-center border-b border-sidebar-border px-4">
        <Brand />
      </div>
      <nav aria-label={t("mainNavigation")} className="flex-1 overflow-y-auto p-4">
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
