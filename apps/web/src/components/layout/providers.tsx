"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Client-side providers shared by every page: theme (light/dark/system) and tooltips.
 * i18n comes from `NextIntlClientProvider` in the root layout.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider>{children}</TooltipProvider>
    </ThemeProvider>
  );
}
