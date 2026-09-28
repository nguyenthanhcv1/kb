"use client";

import { ArchiveRestoreIcon, FileTextIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { pageHref } from "@/lib/page-href";
import type { PageSummary } from "@/server/pages";
import { purgePageAction, restorePageAction } from "@/server/pages/actions";

import { pageErrorKey } from "./errors";
import { groupTrash, type TrashEntry } from "./trash";

type TrashListProps = {
  spaceSlug: string;
  /** `listTrash` rows, newest first. */
  pages: PageSummary[];
  /** Space admins may delete for good (`pages_delete` policy); editors only restore. */
  canPurge: boolean;
};

type Notice = { kind: "success" | "error"; text: string; href?: string };

/**
 * Trash of a Space: one row per trashed page (subpages trashed with it are folded in), restore
 * (back to its former place — `restorePage`) and, for admins, "delete permanently" behind a
 * confirmation dialog.
 */
export function TrashList({ spaceSlug, pages, canPurge }: TrashListProps) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirm, setConfirm] = useState<TrashEntry | null>(null);
  const entries = groupTrash(pages);

  const titleOf = (page: PageSummary) => page.title || t("tree.untitled");

  function restore(entry: TrashEntry) {
    setNotice(null);
    setBusyId(entry.page.id);
    startTransition(async () => {
      const result = await restorePageAction({ pageId: entry.page.id });
      setBusyId(null);
      if (!result.ok) {
        setNotice({ kind: "error", text: t(pageErrorKey(result.code)) });
        return;
      }
      setNotice({
        kind: "success",
        text: t("tree.trash.restored", { title: titleOf(result.data) }),
        href: pageHref(spaceSlug, result.data),
      });
      router.refresh();
    });
  }

  function purge(entry: TrashEntry) {
    setNotice(null);
    setBusyId(entry.page.id);
    startTransition(async () => {
      const result = await purgePageAction({ pageId: entry.page.id });
      setBusyId(null);
      setConfirm(null);
      if (!result.ok) {
        setNotice({ kind: "error", text: t(pageErrorKey(result.code)) });
        return;
      }
      setNotice({ kind: "success", text: t("tree.trash.purged", { title: titleOf(entry.page) }) });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div aria-live="polite">
        {notice && (
          <p
            role={notice.kind === "error" ? "alert" : "status"}
            className={
              notice.kind === "error"
                ? "text-sm text-destructive"
                : "flex flex-wrap items-center gap-2 text-sm"
            }
          >
            {notice.text}
            {notice.href && (
              <Link
                href={notice.href}
                className="rounded-sm font-medium underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {t("tree.trash.openPage")}
              </Link>
            )}
          </p>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t("tree.trash.empty")}
        </div>
      ) : (
        <ul aria-label={t("tree.trash.listLabel")} className="divide-y rounded-lg border">
          {entries.map((entry) => (
            <TrashRow
              key={entry.page.id}
              entry={entry}
              title={titleOf(entry.page)}
              href={pageHref(spaceSlug, entry.page)}
              busy={pending && busyId === entry.page.id}
              disabled={pending}
              canPurge={canPurge}
              onRestore={() => restore(entry)}
              onPurge={() => setConfirm(entry)}
            />
          ))}
        </ul>
      )}

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && !pending && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tree.trash.purgeConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm &&
                t("tree.trash.purgeConfirmDescription", {
                  title: titleOf(confirm.page),
                  count: confirm.subpageCount,
                })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("common.actions.cancel")}</AlertDialogCancel>
            {/* A plain button, not AlertDialogAction: the dialog stays open while deleting. */}
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => confirm && purge(confirm)}
            >
              {pending ? t("tree.trash.purging") : t("tree.trash.purge")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TrashRow({
  entry,
  title,
  href,
  busy,
  disabled,
  canPurge,
  onRestore,
  onPurge,
}: {
  entry: TrashEntry;
  title: string;
  href: string;
  busy: boolean;
  disabled: boolean;
  canPurge: boolean;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const t = useTranslations("tree.trash");
  const format = useFormatter();
  const { page } = entry;
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center text-lg"
        >
          {page.icon || <FileTextIcon className="size-5 text-muted-foreground" />}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <Link
            href={href}
            className="truncate rounded-sm font-medium hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {title}
          </Link>
          <p className="text-sm text-muted-foreground">
            {page.deletedAt &&
              t("deletedAt", { date: format.dateTime(new Date(page.deletedAt), "dateTime") })}
            {entry.subpageCount > 0 && (
              <>
                <span aria-hidden> · </span>
                {t("subpages", { count: entry.subpageCount })}
              </>
            )}
          </p>
          {entry.parentInTrash && (
            <p className="text-sm text-muted-foreground">{t("parentInTrash")}</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 sm:shrink-0">
        <Button
          size="sm"
          variant="outline"
          onClick={onRestore}
          disabled={disabled}
          aria-label={t("restoreLabel", { title })}
        >
          <ArchiveRestoreIcon aria-hidden />
          {busy ? t("restoring") : t("restore")}
        </Button>
        {canPurge && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onPurge}
            disabled={disabled}
            aria-label={t("purgeLabel", { title })}
            className="text-destructive hover:text-destructive"
          >
            <Trash2Icon aria-hidden />
            {t("purge")}
          </Button>
        )}
      </div>
    </li>
  );
}
