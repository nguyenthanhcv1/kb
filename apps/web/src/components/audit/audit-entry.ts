import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  auditActionMessageKey,
  isAuditAction,
  type AuditAction,
  type AuditEntityType,
  type AuditLogEntry,
} from "@/server/audit";
import type { AuditPerson } from "@/server/audit/queries";

/**
 * Pure mapping from an audit entry to what the list shows (labels are message keys in the `audit`
 * namespace; values are codes the component translates). Metadata shapes: see
 * `auditLogEntrySchema` in `@/server/audit`.
 */

/** Action prefixes written for a Space (the rest — access, settings, user — are system-wide). */
const SPACE_ACTION_GROUPS = ["space", "member", "invitation", "page", "version"] as const;
export type SpaceAuditActionGroup = (typeof SPACE_ACTION_GROUPS)[number];

/** Filter options of the Space audit page, grouped by entity (`audit.entityTypes.<group>`). */
export const SPACE_AUDIT_ACTION_GROUPS: { group: SpaceAuditActionGroup; actions: AuditAction[] }[] =
  SPACE_ACTION_GROUPS.map((group) => ({
    group,
    actions: AUDIT_ACTIONS.filter((action) => action.startsWith(`${group}.`)),
  }));

export const SPACE_AUDIT_ACTIONS: AuditAction[] = SPACE_AUDIT_ACTION_GROUPS.flatMap(
  (g) => g.actions,
);

/** `?action=` of the Space audit page → a Space action, or `null` (all actions) when invalid. */
export function parseSpaceAuditAction(value: string | string[] | undefined): AuditAction | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && isAuditAction(raw) && SPACE_AUDIT_ACTIONS.includes(raw) ? raw : null;
}

/** `?cursor=` → the cursor string, or `null`. The contract validates it (`VALIDATION_FAILED`). */
export function parseAuditCursor(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw ? raw : null;
}

/** URL of the audit page with the given filter and page. */
export function auditPageHref(
  base: string,
  { action, cursor }: { action?: string | null; cursor?: string | null },
): string {
  const params = new URLSearchParams();
  if (action) params.set("action", action);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

type DotToUnderscore<S extends string> = S extends `${infer A}.${infer B}` ? `${A}_${B}` : S;
/** Message key of an action label in the `audit` namespace. */
export type AuditActionMessageKey = `actions.${DotToUnderscore<AuditAction>}` | "actions.unknown";

/** Message key (in `audit`) and ICU values of an action; unknown codes get the fallback label. */
export function auditActionLabel(action: string): {
  key: AuditActionMessageKey;
  values?: { action: string };
} {
  return isAuditAction(action)
    ? { key: auditActionMessageKey(action) as AuditActionMessageKey }
    : { key: "actions.unknown", values: { action } };
}

/** Message key (in `audit`) of an entity type, `null` for an unknown type. */
export function auditEntityTypeKey(entityType: string): `entityTypes.${AuditEntityType}` | null {
  return (AUDIT_ENTITY_TYPES as readonly string[]).includes(entityType)
    ? `entityTypes.${entityType as AuditEntityType}`
    : null;
}

/** Who or what the entry is about. */
export type AuditTarget =
  | { kind: "person"; person: AuditPerson | null }
  | { kind: "text"; text: string }
  | { kind: "entity"; entityType: string };

/** A line of detail below the action. Role and visibility values are codes. */
export type AuditDetail =
  | { kind: "roleChange"; from: string; to: string }
  | { kind: "role"; role: string }
  | { kind: "left" }
  | { kind: "expiresAt"; at: string }
  | { kind: "fieldChange"; field: string; from: unknown; to: unknown };

export type AuditEntryView = { target: AuditTarget; details: AuditDetail[] };

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** `{ changes: { <column>: { from, to } } }` → one detail per changed column. */
function fieldChanges(changes: unknown): AuditDetail[] {
  const map = record(changes);
  if (!map) return [];
  return Object.entries(map).flatMap(([field, change]) => {
    const pair = record(change);
    return pair ? [{ kind: "fieldChange" as const, field, from: pair.from, to: pair.to }] : [];
  });
}

export function describeAuditEntry(
  entry: Pick<AuditLogEntry, "action" | "entityType" | "metadata">,
  people: Record<string, AuditPerson>,
): AuditEntryView {
  const m = entry.metadata;
  const userId = str(m.user_id)?.toLowerCase() ?? null;
  const person = userId ? (people[userId] ?? null) : null;
  const role = str(m.role);

  switch (entry.action) {
    case "member.add":
      return { target: { kind: "person", person }, details: role ? [{ kind: "role", role }] : [] };
    case "member.role_change": {
      const from = str(m.from_role);
      const to = str(m.to_role);
      return {
        target: { kind: "person", person },
        details: from && to ? [{ kind: "roleChange", from, to }] : [],
      };
    }
    case "member.remove":
      return {
        target: { kind: "person", person },
        details: [
          ...(role ? [{ kind: "role" as const, role }] : []),
          ...(m.self === true ? [{ kind: "left" as const }] : []),
        ],
      };
    case "invitation.create":
    case "invitation.revoke":
    case "invitation.accept": {
      const email = str(m.email);
      const expires = entry.action === "invitation.create" ? str(m.expires_at) : null;
      return {
        target: email
          ? { kind: "text", text: email }
          : { kind: "entity", entityType: entry.entityType },
        details: [
          ...(role ? [{ kind: "role" as const, role }] : []),
          ...(expires ? [{ kind: "expiresAt" as const, at: expires }] : []),
        ],
      };
    }
    case "space.update":
    case "settings.update":
    case "access.update": {
      const value = str(m.value);
      return {
        target: value
          ? { kind: "text", text: value }
          : { kind: "entity", entityType: entry.entityType },
        details: fieldChanges(m.changes),
      };
    }
    default: {
      const text = str(m.name) ?? str(m.title) ?? str(m.email) ?? str(m.value);
      if (text) return { target: { kind: "text", text }, details: [] };
      if (userId) return { target: { kind: "person", person }, details: [] };
      return { target: { kind: "entity", entityType: entry.entityType }, details: [] };
    }
  }
}

/** Up to two initials of a displayed name (or the first letter of an email). */
export function nameInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const picked = words.length > 1 ? [words[0], words.at(-1)] : words.slice(0, 1);
  return picked.map((word) => Array.from(word ?? "")[0]?.toUpperCase() ?? "").join("");
}
