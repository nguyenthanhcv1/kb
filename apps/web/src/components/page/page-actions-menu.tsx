"use client";

import { EllipsisIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PageSummary } from "@/server/pages";
import { trashPageAction } from "@/server/pages/actions";

import { pageErrorKey } from "./errors";

/**
 * "…" menu of a page for editors: move to trash (with its subpages; restorable from the Space
 * trash). The sidebar tree (T2.3) has its own context menu with the same actions.
 */
export function PageActionsMenu({ page }: { page: Pick<PageSummary, "id"> }) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function moveToTrash() {
    setError(null);
    startTransition(async () => {
      const result = await trashPageAction({ pageId: page.id });
      if (!result.ok) {
        setError(t(pageErrorKey(result.code)));
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t("tree.page.menu")} disabled={pending}>
            <EllipsisIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onSelect={moveToTrash}>
            <Trash2Icon aria-hidden />
            {t("tree.actions.moveToTrash")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
