"use client";

import { AtSignIcon, GlobeIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import type { AccessEntry } from "@/server/admin";

import { RemoveAccessEntryDialog } from "./remove-access-entry-dialog";

/**
 * The allowlist (domains first, then emails — the contract's order): kind, value, note, how many
 * active users each entry covers, who added it, and "remove" (disabled on the caller's own email).
 */
export function AccessEntryList({ entries }: { entries: AccessEntry[] }) {
  const t = useTranslations("admin.access");
  const id = useId();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <section aria-labelledby={`${id}-title`} className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {t("list.title")}
        </h2>
        <span className="text-sm text-muted-foreground">
          {t("list.count", { count: entries.length })}
        </span>
      </div>
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {message}
      </p>

      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("list.empty")}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 text-muted-foreground" aria-hidden>
                  {entry.kind === "domain" ? (
                    <GlobeIcon className="size-4" />
                  ) : (
                    <AtSignIcon className="size-4" />
                  )}
                </span>
                <div className="grid min-w-0 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium break-all">{entry.value}</span>
                    <Badge variant="secondary">{t(`kinds.${entry.kind}`)}</Badge>
                    {entry.publicDomain && (
                      <Badge variant="destructive">
                        <TriangleAlertIcon aria-hidden />
                        {t("list.publicDomain")}
                      </Badge>
                    )}
                    {entry.isSelf && <Badge variant="outline">{t("list.self")}</Badge>}
                  </div>
                  {entry.note && <p className="text-sm break-words">{entry.note}</p>}
                  <p className="text-xs text-muted-foreground">
                    {t("list.users", { count: entry.userCount })}
                    {" · "}
                    {entry.createdByEmail
                      ? t("list.addedBy", {
                          email: entry.createdByEmail,
                          date: new Date(entry.createdAt),
                        })
                      : t("list.addedBySystem", { date: new Date(entry.createdAt) })}
                  </p>
                  {entry.isSelf && (
                    <p id={`${id}-${entry.id}-self`} className="text-xs text-muted-foreground">
                      {t("list.selfHint")}
                    </p>
                  )}
                </div>
              </div>
              <RemoveAccessEntryDialog
                entry={entry}
                describedBy={entry.isSelf ? `${id}-${entry.id}-self` : undefined}
                onRemoved={(value) => setMessage(t("remove.removed", { value }))}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
