import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AboutSection } from "@/components/settings/about-section";
import { getAboutInfo } from "@/server/release";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

/** Personal settings (frame and sign-in check: `(app)/layout.tsx`). T0.6b ships the About section; profile, language and time zone come with T1.3. */
export default async function SettingsPage() {
  const [t, about] = await Promise.all([getTranslations("settings"), getAboutInfo()]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <AboutSection about={about} />
    </div>
  );
}
