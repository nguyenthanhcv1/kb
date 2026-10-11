import type { Locale } from "@kb/i18n";
import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { WhatsNewList } from "@/components/whats-new/whats-new-list";
import { appInfo } from "@/lib/env";
import { getReleaseNotes } from "@/server/release";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("whatsNew");
  return { title: t("title") };
}

/** "What's new": release notes of every version in the reader's language (docs/PLAN.md §6.3). */
export default async function WhatsNewPage() {
  const [t, tNav, tShell, locale] = await Promise.all([
    getTranslations("whatsNew"),
    getTranslations("nav"),
    getTranslations("common.shell"),
    getLocale(),
  ]);
  const releases = getReleaseNotes(locale as Locale);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <Link
        href="/"
        className="flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
        {tNav("home")}
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-[32px] leading-10 font-bold tracking-[-0.02em]">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          {t("current")}
          <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs font-medium text-foreground">
            {tShell("version", { version: appInfo().version })}
          </span>
        </p>
      </div>
      <WhatsNewList releases={releases} />
    </div>
  );
}
