import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AppShell } from "@/components/layout/app-shell";
import { AboutSection } from "@/components/settings/about-section";
import { getCurrentUser } from "@/server/auth/mock";
import { getAboutInfo } from "@/server/release";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

/** Personal settings. T0.6b ships the About section; profile, language and time zone come with T1.3. */
export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [t, about] = await Promise.all([getTranslations("settings"), getAboutInfo()]);

  return (
    <AppShell user={user} version={about.version}>
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <AboutSection about={about} />
      </div>
    </AppShell>
  );
}
