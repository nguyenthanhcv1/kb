"use client";

import { ArchiveIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { Space } from "@/server/space";
import { archiveSpace } from "@/server/space/actions";

import { spaceErrorKey } from "./errors";

/**
 * "Archive" zone of the Space settings, with a confirmation dialog. Archiving hides the Space
 * from everyone (RLS), so the user is sent back to the Spaces list. `SPACE_NOT_FOUND` means it
 * was already archived (see `archiveSpace`), which is treated as done.
 */
export function ArchiveSpaceSection({ space }: { space: Pick<Space, "id" | "name"> }) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await archiveSpace({ id: space.id });
      if (!result.ok && result.error !== "SPACE_NOT_FOUND") {
        setError(t(spaceErrorKey(result.error)));
        return;
      }
      setOpen(false);
      router.push("/");
      router.refresh();
    });
  }

  return (
    <section
      aria-labelledby="archive-space-heading"
      className="grid gap-3 rounded-lg border border-destructive/40 p-4"
    >
      <div className="grid gap-1">
        <h2 id="archive-space-heading" className="text-lg font-semibold">
          {t("space.archiveSection.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("space.archiveSection.description")}</p>
      </div>
      <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" className="justify-self-start">
            <ArchiveIcon aria-hidden />
            {t("space.archiveSection.action")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("space.archiveSection.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("space.archiveSection.confirmDescription", { name: space.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("common.actions.cancel")}</AlertDialogCancel>
            {/* A plain button, not AlertDialogAction: the dialog stays open while archiving. */}
            <Button variant="destructive" onClick={onConfirm} disabled={pending}>
              {pending ? t("space.archiveSection.archiving") : t("space.archiveSection.confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
