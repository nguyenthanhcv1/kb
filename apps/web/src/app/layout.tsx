import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { getCommonTranslations, getShellIntl } from "@/components/layout/intl";
import { Providers } from "@/components/layout/providers";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getCommonTranslations();
  return {
    title: { default: t("app.name"), template: `%s · ${t("app.name")}` },
    description: t("app.tagline"),
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "white" },
    { media: "(prefers-color-scheme: dark)", color: "black" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale, timeZone, messages } = await getShellIntl();
  return (
    // next-themes sets the `dark` class on <html> before hydration.
    <html lang={locale} suppressHydrationWarning>
      <body>
        <Providers locale={locale} timeZone={timeZone} messages={messages}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
