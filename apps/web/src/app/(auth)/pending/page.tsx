import { HourglassIcon } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { getCurrentUser, signOut } from "@/server/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.pending");
  return { title: t("title") };
}

/**
 * Shown to a signed-in account that a super admin has not approved yet (`profiles.status =
 * 'pending'`). The middleware sends such accounts here from every other screen and sends approved
 * ones back to `/`, so this page only ever needs to explain the wait and offer "sign out".
 */
export default async function PendingApprovalPage() {
  const [t, user] = await Promise.all([getTranslations("auth.pending"), getCurrentUser()]);
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <HourglassIcon className="size-6" aria-hidden />
      </div>
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      {user && (
        <p className="text-sm font-medium break-all">{t("signedInAs", { email: user.email })}</p>
      )}
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      <form action={signOut} className="mt-2 w-full">
        <Button type="submit" variant="outline" className="w-full">
          {t("signOut")}
        </Button>
      </form>
    </div>
  );
}
