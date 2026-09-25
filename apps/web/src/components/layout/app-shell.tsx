"use client";

import { MenuIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

import { Brand } from "./brand";
import { LocaleSwitcher } from "./locale-switcher";
import { Sidebar } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";

type AppShellProps = {
  /** Navigation rendered in the sidebar (desktop) or in the slide-over drawer (< md). */
  sidebar?: ReactNode;
  children: ReactNode;
};

/**
 * Signed-in app frame: fixed sidebar from `md` (768 px), a drawer below that,
 * a top bar with the language and theme switchers, and a skip link to the main content.
 */
export function AppShell({ sidebar, children }: AppShellProps) {
  const t = useTranslations("common.shell");
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-[3px] focus:ring-ring/50"
      >
        {t("skipToContent")}
      </a>

      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-sidebar-border md:block">
        <Sidebar>{sidebar}</Sidebar>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label={t("openSidebar")}
              >
                <MenuIcon className="size-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-72 gap-0 p-0"
              closeLabel={t("closeSidebar")}
              aria-describedby={undefined}
              // Close the drawer once a link inside it is followed.
              onClickCapture={(event) => {
                if ((event.target as HTMLElement).closest("a")) setOpen(false);
              }}
            >
              <SheetTitle className="sr-only">{t("mainNavigation")}</SheetTitle>
              <Sidebar>{sidebar}</Sidebar>
            </SheetContent>
          </Sheet>
          <div className="md:hidden">
            <Brand />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
