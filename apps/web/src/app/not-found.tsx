import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { ErrorState } from "@/components/layout/error-state";
import { Button } from "@/components/ui/button";

export async function generateMetadata() {
  const t = await getTranslations("common");
  return { title: t("notFound.title") };
}

export default async function NotFound() {
  const t = await getTranslations("common");
  return (
    <ErrorState
      code={t("notFound.code")}
      title={t("notFound.title")}
      description={t("notFound.description")}
      actions={
        <Button asChild>
          <Link href="/">{t("notFound.backHome")}</Link>
        </Button>
      }
    />
  );
}
