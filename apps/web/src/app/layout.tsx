import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { Providers } from "@/components/layout/providers";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import {
  type PublicSupabaseConfig,
  publicSupabaseConfigScript,
} from "@/lib/supabase/public-config";

import "./globals.css";

// KA Atlas type: Be Vietnam Pro (drawn for Vietnamese diacritics) and JetBrains Mono for
// versions and codes. next/font self-hosts the files; globals.css reads the variables.
const sans = Be_Vietnam_Pro({
  subsets: ["latin", "latin-ext", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-be-vietnam-pro",
});
const mono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.app");
  return {
    title: { default: t("name"), template: `%s · ${t("name")}` },
    description: t("tagline"),
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "white" },
    { media: "(prefers-color-scheme: dark)", color: "black" },
  ],
};

/**
 * Read at request time (dynamic `process.env` lookups in `env.ts`), not inlined at build: the
 * Docker image only gets these variables when the container starts.
 */
function runtimeSupabaseConfig(): PublicSupabaseConfig | null {
  try {
    return { url: supabaseUrl(), anonKey: supabaseAnonKey() };
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const supabase = runtimeSupabaseConfig();
  return (
    // next-themes sets the `dark` class on <html> before hydration.
    <html lang={locale} className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        {supabase ? (
          // Runs before hydration, so browser Supabase clients (uploads, realtime) see it.
          <script dangerouslySetInnerHTML={{ __html: publicSupabaseConfigScript(supabase) }} />
        ) : null}
        {/* Inherits locale, time zone, now, formats and messages from src/i18n/request.ts. */}
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
