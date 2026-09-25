import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Brand } from "./brand";

/**
 * Sidebar frame: brand on top, then the navigation passed by the page
 * (Space list and page tree arrive with T1.4b / T2.3). Empty → a placeholder text.
 */
export function Sidebar({ children }: { children?: ReactNode }) {
  const t = useTranslations("common.shell");
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 shrink-0 items-center border-b border-sidebar-border px-4">
        <Brand />
      </div>
      <nav aria-label={t("mainNavigation")} className="flex-1 overflow-y-auto p-4">
        {children ?? <p className="text-sm text-muted-foreground">{t("sidebarEmpty")}</p>}
      </nav>
    </div>
  );
}
