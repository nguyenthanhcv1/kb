"use client";

import { locales } from "@kb/i18n/config";
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
import { cn } from "@/components/ui/utils";
import { setLocale } from "@/server/profile/actions";

/**
 * Vietnamese / English switcher. Each language is shown in its own name.
 * The choice goes to the `NEXT_LOCALE` cookie and, when signed in, to `profiles.locale` (so it
 * follows the user to other devices) — see `setLocale`; then the server components re-render.
 * `segmented` shows both languages as VI / EN buttons (the app's top bar); `menu` is a dropdown.
 */
export function LocaleSwitcher({ variant = "menu" }: { variant?: "menu" | "segmented" }) {
  const t = useTranslations("common.locale");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(value: string) {
    const next = locales.find((l) => l === value);
    if (!next || next === locale) return;
    startTransition(async () => {
      const result = await setLocale(next);
      if (!result.ok) console.error("[i18n] saving the locale failed", result.error);
      router.refresh();
    });
  }

  if (variant === "segmented") {
    return (
      <div
        role="group"
        aria-label={t("label")}
        aria-busy={pending}
        className="flex rounded-md bg-secondary p-[3px]"
      >
        {locales.map((value) => (
          <button
            key={value}
            type="button"
            lang={value}
            aria-pressed={value === locale}
            aria-label={t(`names.${value}`)}
            disabled={pending}
            onClick={() => onChange(value)}
            className={cn(
              "h-8 min-w-9 rounded-[4px] px-2 text-[13px] font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60",
              value === locale && "bg-card text-foreground shadow-xs",
            )}
          >
            {t(`short.${value}`)}
          </button>
        ))}
      </div>
    );
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
