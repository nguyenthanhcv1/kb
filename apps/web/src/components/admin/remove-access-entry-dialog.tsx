"use client";

import { Trash2Icon } from "lucide-react";
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
import type { AccessEntry, AccessImpact } from "@/server/admin";
import { previewAccessRemoval, removeAccessEntries } from "@/server/admin/actions";

import { adminErrorKey } from "./errors";

type Props = {
  entry: AccessEntry;
  /** Id of the text explaining why the button is disabled (own email). */
  describedBy?: string;
  onRemoved: (value: string) => void;
};

/**
 * "Remove" button + confirmation of one allowlist entry. Opening the dialog loads who would be
 * affected (`previewAccessRemoval`); the caller's own email cannot be removed (disabled here,
 * `ACCESS_CANNOT_REMOVE_SELF` from the server otherwise). `ACCESS_ENTRY_NOT_FOUND` means someone
 * else removed it already, which is treated as done.
 */
export function RemoveAccessEntryDialog({ entry, describedBy, onRemoved }: Props) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<AccessImpact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    setError(null);
    if (!next) return;
    setImpact(null);
    startLoading(async () => {
      const result = await previewAccessRemoval({ ids: [entry.id] });
      if (result.ok) setImpact(result.data);
      else setError(t(adminErrorKey(result.error)));
    });
  }

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await removeAccessEntries({ ids: [entry.id] });
      if (!result.ok && result.error !== "ACCESS_ENTRY_NOT_FOUND") {
        setError(t(adminErrorKey(result.error)));
        return;
      }
      setOpen(false);
      onRemoved(entry.value);
      router.refresh();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="self-start sm:self-center"
          disabled={entry.isSelf}
          aria-label={t("admin.access.list.removeLabel", { value: entry.value })}
          aria-describedby={describedBy}
        >
          <Trash2Icon aria-hidden />
          {t("admin.access.list.remove")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="break-all">
            {t("admin.access.remove.title", { value: entry.value })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t("admin.access.remove.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div aria-live="polite" className="grid gap-1 text-sm">
          {loading && (
            <p className="text-muted-foreground">{t("admin.access.remove.impactLoading")}</p>
          )}
          {impact && (
            <>
              <p className="font-medium">
                {t("admin.access.remove.impactMatched", { count: impact.matchedUsers })}
              </p>
              {impact.losingAccess > 0 && (
                <p className="text-destructive">
                  {t("admin.access.remove.impactLosing", { count: impact.losingAccess })}
                </p>
              )}
              {impact.becomingGuest > 0 && (
                <p>{t("admin.access.remove.impactGuest", { count: impact.becomingGuest })}</p>
              )}
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("common.actions.cancel")}</AlertDialogCancel>
          {/* A plain button, not AlertDialogAction: the dialog stays open while removing. */}
          <Button variant="destructive" onClick={onConfirm} disabled={pending || loading}>
            {pending ? t("admin.access.remove.removing") : t("admin.access.remove.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
