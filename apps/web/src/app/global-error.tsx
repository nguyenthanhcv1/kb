"use client";

import { defaultLocale, defaultTimeZone } from "@kb/i18n/config";
import common from "@kb/i18n/messages/vi/common.json";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { ThemeProvider } from "next-themes";

import { ErrorState } from "@/components/layout/error-state";
import { Button } from "@/components/ui/button";

import "./globals.css";

type GlobalErrorProps = { error: Error & { digest?: string }; retry: () => void };

/**
 * Last-resort boundary: replaces the root layout when it fails, so it brings its own
 * document, styles, theme and messages (default locale, bundled statically).
 */
export default function GlobalError({ error, retry }: GlobalErrorProps) {
  return (
    <html lang={defaultLocale} suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <NextIntlClientProvider
            locale={defaultLocale}
            timeZone={defaultTimeZone}
            messages={{ common }}
          >
            <GlobalErrorContent digest={error.digest} retry={retry} />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

function GlobalErrorContent({ digest, retry }: { digest?: string; retry: () => void }) {
  const t = useTranslations("common.error");
  return (
    <>
      <title>{t("title")}</title>
      <ErrorState
        code="500"
        title={t("title")}
        description={t("description")}
        detail={digest ? t("digest", { digest }) : undefined}
        actions={<Button onClick={() => retry()}>{t("retry")}</Button>}
      />
    </>
  );
}
