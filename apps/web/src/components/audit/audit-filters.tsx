"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";

import {
  SPACE_AUDIT_ACTION_GROUPS,
  auditActionGroupsFor,
  auditActionLabel,
  auditPageHref,
  hasAuditFilters,
  type AuditFilters as Filters,
} from "./audit-entry";

export type AuditActorOption = { id: string; name: string };

/**
 * Filters of the Space audit page: person, kind of thing, action and date range (T6.4b). Every
 * change navigates to the first page with the filters in the URL (shareable); the page reads them
 * from `searchParams`. Dates are whole days in the display time zone, both ends inclusive.
 */
export function AuditFilters({
  base,
  filters,
  actors,
}: {
  base: string;
  filters: Filters;
  actors: AuditActorOption[];
}) {
  const t = useTranslations("audit");
  const router = useRouter();
  const id = useId();
  const [pending, startTransition] = useTransition();

  function change(patch: Partial<Filters>) {
    const next: Filters = { ...filters, ...patch };
    // The action must belong to the chosen type.
    if (patch.type && next.action && !next.action.startsWith(`${patch.type}.`)) next.action = null;
    startTransition(() => router.push(auditPageHref(base, next)));
  }

  const selectedActorKnown = !filters.actor || actors.some((a) => a.id === filters.actor);
  const rangeError =
    filters.from && filters.to && filters.from > filters.to ? t("page.rangeInvalid") : null;

  return (
    <div
      role="group"
      aria-label={t("page.filtersLabel")}
      aria-busy={pending || undefined}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-actor`}>{t("page.actorLabel")}</Label>
        <NativeSelect
          id={`${id}-actor`}
          value={filters.actor ?? ""}
          onChange={(e) => change({ actor: e.target.value || null })}
          className="w-full"
        >
          <NativeSelectOption value="">{t("page.allActors")}</NativeSelectOption>
          {actors.map((a) => (
            <NativeSelectOption key={a.id} value={a.id}>
              {a.name}
            </NativeSelectOption>
          ))}
          {!selectedActorKnown && filters.actor && (
            <NativeSelectOption value={filters.actor}>{t("actor.unknown")}</NativeSelectOption>
          )}
        </NativeSelect>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-type`}>{t("page.typeLabel")}</Label>
        <NativeSelect
          id={`${id}-type`}
          value={filters.type ?? ""}
          onChange={(e) => change({ type: (e.target.value || null) as Filters["type"] })}
          className="w-full"
        >
          <NativeSelectOption value="">{t("page.allTypes")}</NativeSelectOption>
          {SPACE_AUDIT_ACTION_GROUPS.map(({ group }) => (
            <NativeSelectOption key={group} value={group}>
              {t(`entityTypes.${group}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-action`}>{t("page.filterLabel")}</Label>
        <NativeSelect
          id={`${id}-action`}
          value={filters.action ?? ""}
          onChange={(e) => change({ action: (e.target.value || null) as Filters["action"] })}
          className="w-full"
        >
          <NativeSelectOption value="">{t("page.allActions")}</NativeSelectOption>
          {auditActionGroupsFor(filters.type).map(({ group, actions }) => (
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

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-from`}>{t("page.fromLabel")}</Label>
        <Input
          id={`${id}-from`}
          type="date"
          value={filters.from ?? ""}
          max={filters.to ?? undefined}
          onChange={(e) => change({ from: e.target.value || null })}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-to`}>{t("page.toLabel")}</Label>
        <Input
          id={`${id}-to`}
          type="date"
          value={filters.to ?? ""}
          min={filters.from ?? undefined}
          onChange={(e) => change({ to: e.target.value || null })}
        />
      </div>

      <div className="flex items-end">
        <Button
          type="button"
          variant="ghost"
          disabled={!hasAuditFilters(filters)}
          onClick={() => startTransition(() => router.push(base))}
        >
          {t("page.resetFilters")}
        </Button>
      </div>

      {rangeError && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2 lg:col-span-3">
          {rangeError}
        </p>
      )}
    </div>
  );
}
