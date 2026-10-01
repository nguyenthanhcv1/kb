"use client";

import { CloudOffIcon, CheckIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import type { CollabStatus } from "@/lib/collab/status";

/**
 * Save indicator of a collaborative page: saved / saving / offline (typing continues locally and
 * syncs on reconnect). Terminal failures show an alert: `outdated` offers a reload.
 */
export function CollabStatusIndicator({ status }: { status: CollabStatus }) {
  const t = useTranslations("editor.collab");

  if (status === "outdated" || status === "forbidden") {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
      >
        <TriangleAlertIcon className="size-4 shrink-0 text-destructive" aria-hidden />
        <span className="flex-1">{t(`${status}.description`)}</span>
        {status === "outdated" && (
          <Button size="sm" onClick={() => window.location.reload()}>
            {t("outdated.reload")}
          </Button>
        )}
      </div>
    );
  }

  const Icon =
    status === "saved" ? CheckIcon : status === "offline" ? CloudOffIcon : LoaderCircleIcon;
  return (
    <p
      role="status"
      aria-live="polite"
      data-status={status}
      className="flex items-center gap-1.5 text-xs text-muted-foreground data-[status=offline]:text-destructive"
    >
      <Icon
        className={
          status === "saving" || status === "connecting" ? "size-3.5 animate-spin" : "size-3.5"
        }
        aria-hidden
      />
      {t(`status.${status}`)}
    </p>
  );
}
