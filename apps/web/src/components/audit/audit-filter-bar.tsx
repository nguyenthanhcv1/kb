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
  auditActionLabel,
  auditPageHref,
  hasAuditFilters,
  type AuditFilters,
} from "./audit-entry";

export type AuditFilterPerson = { id: string; name: string };

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

/**
 * Filters of the Space audit page: kind of thing, action, person and day range. Every change
 * navigates to the first page of `?type=&action=&actor=&from=&to=`; the page reads them from
 * `searchParams`, so the URL is shareable.
 */
export function AuditFilterBar({
  base,
  filters,
  people,
}: {
  base: string;
  filters: AuditFilters;
  people: AuditFilterPerson[];
}) {
  const t = useTranslations("audit");
  const router = useRouter();
  const id = useId();
  const [pending, startTransition] = useTransition();

  function update(patch: Partial<AuditFilters>) {
    const next = { ...filters, ...patch };
    // The action list depends on the type: drop an action that no longer belongs to it.
    if (patch.type !== undefined && next.action && !next.action.startsWith(`${patch.type}.`)) {
      next.action = null;
    }
    startTransition(() => router.push(auditPageHref(base, next)));
  }

  const groups = filters.type
    ? SPACE_AUDIT_ACTION_GROUPS.filter((g) => g.group === filters.type)
    : SPACE_AUDIT_ACTION_GROUPS;

  return (
    <div
      role="search"
      aria-label={t("page.filtersLabel")}
      aria-busy={pending || undefined}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
    >
      <Field label={t("page.typeLabel")} htmlFor={`${id}-type`}>
        <NativeSelect
          id={`${id}-type`}
          value={filters.type ?? ""}
          onChange={(e) => update({ type: (e.target.value || null) as AuditFilters["type"] })}
        >
          <NativeSelectOption value="">{t("page.allTypes")}</NativeSelectOption>
          {SPACE_AUDIT_ACTION_GROUPS.map(({ group }) => (
            <NativeSelectOption key={group} value={group}>
              {t(`entityTypes.${group}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field label={t("page.filterLabel")} htmlFor={`${id}-action`}>
        <NativeSelect
          id={`${id}-action`}
          value={filters.action ?? ""}
          onChange={(e) => update({ action: (e.target.value || null) as AuditFilters["action"] })}
        >
          <NativeSelectOption value="">{t("page.allActions")}</NativeSelectOption>
          {groups.map(({ group, actions }) => (
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
      </Field>
      <Field label={t("page.actorLabel")} htmlFor={`${id}-actor`}>
        <NativeSelect
          id={`${id}-actor`}
          value={filters.actor ?? ""}
          onChange={(e) => update({ actor: e.target.value || null })}
        >
          <NativeSelectOption value="">{t("page.allActors")}</NativeSelectOption>
          {people.map((person) => (
            <NativeSelectOption key={person.id} value={person.id}>
              {person.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field label={t("page.fromLabel")} htmlFor={`${id}-from`}>
        <Input
          id={`${id}-from`}
          type="date"
          value={filters.from ?? ""}
          max={filters.to ?? undefined}
          onChange={(e) => update({ from: e.target.value || null })}
        />
      </Field>
      <Field label={t("page.toLabel")} htmlFor={`${id}-to`}>
        <Input
          id={`${id}-to`}
          type="date"
          value={filters.to ?? ""}
          min={filters.from ?? undefined}
          onChange={(e) => update({ to: e.target.value || null })}
        />
      </Field>
      {hasAuditFilters(filters) && (
        <div className="sm:col-span-2 lg:col-span-5">
          <Button type="button" variant="ghost" size="sm" onClick={() => router.push(base)}>
            {t("page.clearFilters")}
          </Button>
        </div>
      )}
    </div>
  );
}
