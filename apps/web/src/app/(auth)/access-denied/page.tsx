import { ShieldXIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.accessDenied");
  return { title: t("title") };
}

/**
 * Shown for `AUTH_NOT_ALLOWED`: the Google account is neither in `access_allowlist`
 * nor invited to a Space. The OAuth callback (T1.2a) redirects here after signing the user out.
 */
export default async function AccessDeniedPage() {
  const t = await getTranslations("auth.accessDenied");
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <ShieldXIcon className="size-6" aria-hidden />
      </div>
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      <Button asChild className="mt-2 w-full">
        <Link href="/login">{t("switchAccount")}</Link>
      </Button>
    </div>
  );
}
