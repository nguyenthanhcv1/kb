"use client";

import { localeCookieName, locales, type Locale } from "@kb/i18n/config";
import { LanguagesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Stores the chosen locale in the `NEXT_LOCALE` cookie read by `src/i18n/request.ts`. */
export function persistLocale(locale: Locale) {
  document.cookie = `${localeCookieName}=${locale}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}

/**
 * Vietnamese / English switcher. Each language is shown in its own name.
 * The choice goes to the cookie, then the server components re-render in the new locale.
 * Signed-in users will also get it saved to `profiles.locale` (T1.3).
 */
export function LocaleSwitcher() {
  const t = useTranslations("common.locale");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(value: string) {
    const next = locales.find((l) => l === value);
    if (!next || next === locale) return;
    persistLocale(next);
    startTransition(() => router.refresh());
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("toggle")} aria-busy={pending}>
          <LanguagesIcon className="size-5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("label")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={locale} onValueChange={onChange}>
          {locales.map((value) => (
            <DropdownMenuRadioItem key={value} value={value} lang={value} disabled={pending}>
              {t(`names.${value}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
