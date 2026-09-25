"use client";

import type { Locale, Messages } from "@kb/i18n";
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";

type ProvidersProps = {
  locale: Locale;
  timeZone: string;
  messages: Messages;
  children: ReactNode;
};

/** Client-side providers shared by every page: theme (light/dark/system), i18n, tooltips. */
export function Providers({ locale, timeZone, messages, children }: ProvidersProps) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <NextIntlClientProvider locale={locale} timeZone={timeZone} messages={messages}>
        <TooltipProvider>{children}</TooltipProvider>
      </NextIntlClientProvider>
    </ThemeProvider>
  );
}
