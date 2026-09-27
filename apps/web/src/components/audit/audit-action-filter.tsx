"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useTransition } from "react";

import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import type { AuditAction } from "@/server/audit";

import { SPACE_AUDIT_ACTION_GROUPS, auditActionLabel, auditPageHref } from "./audit-entry";

/**
 * Action filter of the Space audit page. Changing it navigates to `?action=<code>` (first page);
 * the page reads the filter from `searchParams`, so the URL is shareable.
 */
export function AuditActionFilter({ base, action }: { base: string; action: AuditAction | null }) {
  const t = useTranslations("audit");
  const router = useRouter();
  const id = useId();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <Label htmlFor={id}>{t("page.filterLabel")}</Label>
      <NativeSelect
        id={id}
        value={action ?? ""}
        aria-busy={pending || undefined}
        onChange={(event) => {
          const next = event.target.value || null;
          startTransition(() => router.push(auditPageHref(base, { action: next })));
        }}
        className="min-w-64"
      >
        <NativeSelectOption value="">{t("page.allActions")}</NativeSelectOption>
        {SPACE_AUDIT_ACTION_GROUPS.map(({ group, actions }) => (
          <NativeSelectOptGroup key={group} label={t(`entityTypes.${group}`)}>
            {actions.map((code) => {
              const label = auditActionLabel(code);
              return (
                <NativeSelectOption key={code} value={code}>
                  {t(label.key, label.values)}
                </NativeSelectOption>
              );
            })}
          </NativeSelectOptGroup>
        ))}
      </NativeSelect>
    </div>
  );
}
