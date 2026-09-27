"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

/** "Back to the Space" of the current `/s/[spaceSlug]/…` URL (for `not-found.tsx`, which gets no params). */
export function BackToSpaceButton() {
  const t = useTranslations("space.settingsPage");
  const { spaceSlug } = useParams<{ spaceSlug?: string }>();
  return (
    <Button asChild variant="outline">
      <Link href={spaceSlug ? `/s/${spaceSlug}` : "/"}>
        <ArrowLeftIcon aria-hidden />
        {t("backToSpace")}
      </Link>
    </Button>
  );
}
