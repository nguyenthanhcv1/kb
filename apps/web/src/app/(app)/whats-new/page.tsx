import type { Locale } from "@kb/i18n";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { WhatsNewList } from "@/components/whats-new/whats-new-list";
import { getReleaseNotes } from "@/server/release";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("whatsNew");
  return { title: t("title") };
}

/** "What's new": release notes of every version in the reader's language (docs/PLAN.md §6.3). */
export default async function WhatsNewPage() {
  const [t, locale] = await Promise.all([getTranslations("whatsNew"), getLocale()]);
  const releases = getReleaseNotes(locale as Locale);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>
      <WhatsNewList releases={releases} />
    </div>
  );
}
