"use client";

import { CheckIcon, RotateCcwIcon } from "lucide-react";
import Link from "next/link";
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
import { restorePageVersionAction } from "@/server/versions/actions";
import type { RestoreVersionActionResult } from "@/server/versions/actions";

export type RestoreVersionFn = (input: {
  pageId: string;
  versionId: string;
}) => Promise<RestoreVersionActionResult>;

type Props = {
  pageId: string;
  versionId: string;
  /** Number shown to the user (`history.versionNo`) or the version's name. */
  versionName: string;
  pageHref: string;
  /** Builds the history URL of a version number (for the "undo" link). */
  versionHrefFor: (versionNo: number) => string;
  /** Test seam; defaults to the server action. */
  restore?: RestoreVersionFn;
};

/**
 * "Restore this version" button + confirmation (T6.3b). Editors and admins only — the caller
 * hides it for viewers, and kb-collab refuses them anyway (`FORBIDDEN`). The confirmation says the
 * page changes for everyone with it open and that the current content is kept as a "Before
 * restore" version; once done, a status line links back to the page and to that version to undo.
 */
export function RestoreVersionDialog({
  pageId,
  versionId,
  versionName,
  pageHref,
  versionHrefFor,
  restore = restorePageVersionAction,
}: Props) {
  const t = useTranslations("history");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ preRestoreVersionNo: number } | null>(null);
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    setError(null);
  }

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await restore({ pageId, versionId });
      if (!result.ok) {
        setError(tErrors(result.code));
        return;
      }
      setDone({ preRestoreVersionNo: result.data.preRestoreVersionNo });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogTrigger asChild>
          <Button size="sm" onClick={() => setDone(null)}>
            <RotateCcwIcon aria-hidden />
            {t("restore")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("restoreDialog.title", { name: versionName })}</AlertDialogTitle>
            <AlertDialogDescription>{t("restoreDialog.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("restoreDialog.cancel")}</AlertDialogCancel>
            {/* A plain button, not AlertDialogAction: the dialog stays open while restoring. */}
            <Button onClick={onConfirm} disabled={pending}>
              {pending ? t("restoreDialog.restoring") : t("restoreDialog.confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {done && (
        <div
          role="status"
          className="flex max-w-sm flex-col gap-1 rounded-md border bg-accent/50 p-3 text-sm"
        >
          <p className="flex items-center gap-1.5 font-medium">
            <CheckIcon className="size-4 text-primary" aria-hidden />
            {t("restoreDone.title")}
          </p>
          <p className="text-muted-foreground">
            {t("restoreDone.undo", { no: done.preRestoreVersionNo })}
          </p>
          <div className="flex flex-wrap gap-x-4">
            <Link href={pageHref} className="font-medium underline-offset-4 hover:underline">
              {t("restoreDone.openPage")}
            </Link>
            <Link
              href={versionHrefFor(done.preRestoreVersionNo)}
              className="font-medium underline-offset-4 hover:underline"
            >
              {t("restoreDone.viewPrevious")}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
