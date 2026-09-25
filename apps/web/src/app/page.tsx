import { AppShell } from "@/components/layout/app-shell";
import { getCommonTranslations } from "@/components/layout/intl";

// Home route inside the app shell. Real content (Space list) arrives with T1.4b.
export default async function HomePage() {
  const t = await getCommonTranslations();
  return (
    <AppShell>
      <div className="mx-auto flex max-w-3xl flex-col gap-2 p-6">
        <h1 className="text-2xl font-semibold">{t("home.title")}</h1>
        <p className="text-muted-foreground">{t("home.description")}</p>
      </div>
    </AppShell>
  );
}
