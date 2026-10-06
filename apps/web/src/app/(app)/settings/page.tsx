import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AboutSection } from "@/components/settings/about-section";
import { AiConnectionsSection } from "@/components/settings/ai-connections-section";
import { PreferencesSection } from "@/components/settings/preferences-section";
import { ProfileSection } from "@/components/settings/profile-section";
import { mcpRequestOrigin } from "@/server/mcp/origin";
import { listMyConnectionsAction } from "@/server/mcp/actions";
import { mcpUrls } from "@/server/mcp/http";
import { isUserClientConfigured } from "@/server/mcp/user-client";
import { getMyProfile } from "@/server/profile/actions";
import { listTimeZones } from "@/server/profile/time-zones";
import { getAboutInfo } from "@/server/release";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

/**
 * Personal settings (frame and sign-in check: `(app)/layout.tsx`): profile (name, avatar),
 * language and time zone (T1.3), AI assistants (MCP connector), About (T0.6b).
 */
export default async function SettingsPage() {
  const [t, about, profileResult, connectionsResult, origin] = await Promise.all([
    getTranslations("settings"),
    getAboutInfo(),
    getMyProfile(),
    listMyConnectionsAction(),
    mcpRequestOrigin(),
  ]);
  if (!profileResult.ok) {
    if (profileResult.error === "UNAUTHORIZED") redirect("/login?next=/settings");
    throw new Error(profileResult.error);
  }
  const profile = profileResult.data;
  const timeZones = listTimeZones(new Date(), [profile.timeZone]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <ProfileSection profile={profile} />
      <PreferencesSection profile={profile} timeZones={timeZones} />
      <AiConnectionsSection
        mcpUrl={mcpUrls(origin).mcp}
        configured={isUserClientConfigured()}
        connections={connectionsResult.ok ? connectionsResult.data : []}
      />
      <AboutSection about={about} />
    </div>
  );
}
