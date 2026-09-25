import type { ReactNode } from "react";

import { Brand } from "@/components/layout/brand";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { ThemeToggle } from "@/components/layout/theme-toggle";

/**
 * Frame of the signed-out screens (login, access denied): brand and the language/theme
 * switchers on top, a centered card below. Language comes from the `NEXT_LOCALE` cookie.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-muted/40 text-foreground">
      <header className="flex h-14 items-center gap-2 px-4">
        <Brand />
        <div className="ml-auto flex items-center gap-1">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <main id="main-content" className="flex flex-1 items-center justify-center p-4 pb-16">
        <div className="w-full max-w-sm rounded-xl border bg-card p-6 text-card-foreground shadow-sm sm:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
