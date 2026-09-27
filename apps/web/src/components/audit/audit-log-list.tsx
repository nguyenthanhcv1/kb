import { useFormatter, useTranslations } from "next-intl";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { AuditActor, AuditLogEntry } from "@/server/audit";
import type { AuditPerson } from "@/server/audit/queries";

import {
  auditActionLabel,
  auditEntityTypeKey,
  describeAuditEntry,
  nameInitials,
  type AuditDetail,
  type AuditTarget,
} from "./audit-entry";

type Translate = ReturnType<typeof useTranslations<never>>;

const ROLE_CODES = ["admin", "editor", "viewer"] as const;
const VISIBILITY_CODES = ["internal", "restricted"] as const;

function includes<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

function roleLabel(t: Translate, role: string): string {
  return includes(ROLE_CODES, role) ? t(`space.roles.${role}`) : role;
}

/** A changed column value: codes are translated, user text is shown as is. */
function fieldValue(t: Translate, field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return t("audit.values.empty");
  if (typeof value === "boolean") return t(value ? "audit.values.on" : "audit.values.off");
  if (field === "visibility" && includes(VISIBILITY_CODES, value)) {
    return t(`space.visibility.${value}`);
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

const FIELDS = ["ai_enabled", "description", "icon", "name", "slug", "visibility"] as const;

function personName(t: Translate, person: Pick<AuditPerson, "fullName" | "email"> | null): string {
  return person?.fullName || person?.email || t("audit.actor.unknown");
}

function ActorAvatar({ actor, name }: { actor: AuditActor | null; name: string }) {
  return (
    <Avatar className="size-8">
      {actor?.avatarUrl && (
        <AvatarImage src={actor.avatarUrl} alt="" referrerPolicy="no-referrer" />
      )}
      <AvatarFallback className="text-xs font-medium" aria-hidden>
        {nameInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

function Target({ t, target }: { t: Translate; target: AuditTarget }) {
  if (target.kind === "person") return <>{personName(t, target.person)}</>;
  if (target.kind === "text") return <>{target.text}</>;
  const key = auditEntityTypeKey(target.entityType);
  return <>{key ? t(`audit.${key}`) : target.entityType}</>;
}

function Detail({ t, detail }: { t: Translate; detail: AuditDetail }) {
  const format = useFormatter();
  switch (detail.kind) {
    case "roleChange":
      return t("audit.details.roleChange", {
        from: roleLabel(t, detail.from),
        to: roleLabel(t, detail.to),
      });
    case "role":
      return t("audit.details.role", { role: roleLabel(t, detail.role) });
    case "left":
      return t("audit.details.left");
    case "expiresAt":
      return t("audit.details.expiresAt", {
        date: format.dateTime(new Date(detail.at), "dateTime"),
      });
    case "fieldChange":
      return t("audit.details.fieldChange", {
        field: includes(FIELDS, detail.field) ? t(`audit.fields.${detail.field}`) : detail.field,
        from: fieldValue(t, detail.field, detail.from),
        to: fieldValue(t, detail.field, detail.to),
      });
  }
}

/**
 * Audit entries, newest first: actor, translated action, target, details (role change from → to,
 * changed fields…) and the time in the viewer's time zone. Works in Server and Client Components.
 */
export function AuditLogList({
  entries,
  people,
}: {
  entries: AuditLogEntry[];
  people: Record<string, AuditPerson>;
}) {
  const t = useTranslations();
  const format = useFormatter();

  return (
    <ol aria-label={t("audit.page.listLabel")} className="divide-y rounded-lg border">
      {entries.map((entry) => {
        const actorName = entry.actor
          ? personName(t, { fullName: entry.actor.fullName, email: entry.actor.email })
          : t("audit.actor.system");
        const label = auditActionLabel(entry.action);
        const view = describeAuditEntry(entry, people);
        const occurredAt = new Date(entry.occurredAt);
        return (
          <li key={entry.id} className="flex gap-3 p-3 sm:p-4" data-action={entry.action}>
            <ActorAvatar actor={entry.actor} name={actorName} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-col gap-x-3 gap-y-0.5 sm:flex-row sm:items-baseline sm:justify-between">
                <p className="min-w-0 text-sm break-words">
                  <span className="font-medium">{actorName}</span>
                  <span className="sr-only">: </span>
                  <span className="block text-muted-foreground sm:inline sm:before:mx-1.5 sm:before:content-['·']">
                    {t(`audit.${label.key}`, label.values)}
                  </span>
                </p>
                <time
                  dateTime={entry.occurredAt}
                  title={format.dateTime(occurredAt, { dateStyle: "full", timeStyle: "long" })}
                  className="shrink-0 text-xs text-muted-foreground tabular-nums"
                >
                  {format.dateTime(occurredAt, "dateTime")}
                </time>
              </div>
              <p className="text-sm font-medium break-words">
                <Target t={t} target={view.target} />
              </p>
              {view.details.length > 0 && (
                <ul className="flex flex-col gap-0.5 text-sm text-muted-foreground">
                  {view.details.map((detail, index) => (
                    <li key={index} className="break-words">
                      <Detail t={t} detail={detail} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
