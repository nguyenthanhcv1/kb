"use client";

import { CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

/** Card frame shared by the settings sections (same look as {@link AboutSection}). */
export function SectionCard({
  titleId,
  title,
  description,
  children,
}: {
  titleId: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={titleId}
      className="rounded-xl border bg-card p-4 text-card-foreground shadow-xs sm:p-6"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        {title}
      </h2>
      <p className="mt-1 mb-5 text-sm text-muted-foreground">{description}</p>
      {children}
    </section>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  );
}

/** Save button plus a polite "Saved" status next to it. */
export function SubmitRow({ pending, saved }: { pending: boolean; saved: boolean }) {
  const t = useTranslations();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" disabled={pending}>
        {pending ? t("settings.form.saving") : t("common.actions.save")}
      </Button>
      <p role="status" className="flex items-center gap-1 text-sm text-muted-foreground">
        {saved && (
          <>
            <CheckIcon className="size-4" aria-hidden />
            {t("settings.form.saved")}
          </>
        )}
      </p>
    </div>
  );
}
