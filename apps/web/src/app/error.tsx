"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { ErrorState } from "@/components/layout/error-state";
import { Button } from "@/components/ui/button";

type ErrorPageProps = { error: Error & { digest?: string }; retry: () => void };

/** Error boundary for every route below the root layout (the "500" page users see). */
export default function ErrorPage({ error, retry }: ErrorPageProps) {
  const t = useTranslations("common");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      code="500"
      title={t("error.title")}
      description={t("error.description")}
      detail={error.digest ? t("error.digest", { digest: error.digest }) : undefined}
      actions={
        <>
          <Button onClick={() => retry()}>{t("error.retry")}</Button>
          <Button variant="outline" asChild>
            <Link href="/">{t("notFound.backHome")}</Link>
          </Button>
        </>
      }
    />
  );
}
