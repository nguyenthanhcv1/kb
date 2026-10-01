"use client";

import { HistoryIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import type { DocumentReplacedReason } from "@/lib/collab/replaced";

/** How long the toast stays before it hides by itself. */
export const DOCUMENT_REPLACED_TOAST_MS = 10_000;

/**
 * Toast for editors that had the page open while its content was replaced for everyone
 * (restore of a version, template, import — T6.3b). The editor already shows the new content;
 * this explains why the text just changed and links to the history so the previous content
 * (saved as a "Before restore" version) can be brought back.
 */
export function DocumentReplacedToast({
  reason,
  historyHref,
  onDismiss,
  durationMs = DOCUMENT_REPLACED_TOAST_MS,
}: {
  reason: DocumentReplacedReason;
  /** `/s/<space>/p/<ref>/history`; no link when unknown. */
  historyHref?: string;
  onDismiss: () => void;
  durationMs?: number;
}) {
  const t = useTranslations("editor.collab.replaced");

  useEffect(() => {
    const timer = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(timer);
  }, [onDismiss, durationMs, reason]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-4 bottom-4 z-50 flex items-start gap-3 rounded-lg border bg-popover p-4 text-sm text-popover-foreground shadow-lg sm:inset-x-auto sm:right-4 sm:w-96"
    >
      <HistoryIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-medium">{t(`${reason}.title`)}</p>
        <p className="text-muted-foreground">{t(`${reason}.description`)}</p>
        {historyHref && reason === "restore" && (
          <Link
            href={historyHref}
            className={buttonVariants({
              variant: "link",
              size: "sm",
              className: "self-start px-0",
            })}
          >
            {t("openHistory")}
          </Link>
        )}
      </div>
      <Button variant="ghost" size="icon-sm" className="-mt-2 -mr-2" onClick={onDismiss}>
        <XIcon aria-hidden />
        <span className="sr-only">{t("dismiss")}</span>
      </Button>
    </div>
  );
}
