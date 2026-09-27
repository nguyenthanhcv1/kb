import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AppShell } from "@/components/layout/app-shell";
import { appInfo } from "@/lib/env";
import { getCurrentUser } from "@/server/auth/mock";

// Home route inside the app shell. Real content (Space list) arrives with T1.4b.
export default async function HomePage() {
  // The middleware (T1.2a) guards every app route; this keeps the page safe on its own.
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations("common");
  return (
    <AppShell user={user} version={appInfo().version}>
      <div className="mx-auto flex max-w-3xl flex-col gap-2 p-6">
        <h1 className="text-2xl font-semibold">{t("home.title")}</h1>
        <p className="text-muted-foreground">{t("home.description")}</p>
      </div>
    </AppShell>
  );
}
