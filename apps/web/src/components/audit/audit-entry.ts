import {
  AUDIT_ACTION_ENTITY_TYPE,
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

/** Filters of the Space audit page (all optional; dates are `YYYY-MM-DD` in the display zone). */
export type AuditFilters = {
  action?: AuditAction | null;
  type?: SpaceAuditActionGroup | null;
  actor?: string | null;
  from?: string | null;
  to?: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Fixed offset of `Asia/Ho_Chi_Minh` (no DST) — the default display zone (AGENTS.md §1). */
const DISPLAY_OFFSET = "+07:00";

type QueryValue = string | string[] | undefined;
const first = (value: QueryValue) => (Array.isArray(value) ? value[0] : value);

/** `?type=` → a Space entity type (`space`, `member`, `invitation`, `page`, `version`) or `null`. */
export function parseSpaceAuditType(value: QueryValue): SpaceAuditActionGroup | null {
  const raw = first(value);
  return (SPACE_ACTION_GROUPS as readonly string[]).includes(raw ?? "")
    ? (raw as SpaceAuditActionGroup)
    : null;
}

/** `YYYY-MM-DD` that is a real calendar date, else `null`. */
export function parseAuditDate(value: QueryValue): string | null {
  const raw = first(value);
  const m = raw ? DATE_RE.exec(raw) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
    ? raw!
    : null;
}

/**
 * Reads every filter from `searchParams`; invalid values are dropped. An action that does not
 * belong to the selected type is dropped too (the type wins).
 */
export function parseAuditFilters(query: Record<string, QueryValue>): AuditFilters {
  const type = parseSpaceAuditType(query.type);
  let action = parseSpaceAuditAction(query.action);
  if (action && type && AUDIT_ACTION_ENTITY_TYPE[action] !== type) action = null;
  const actorRaw = first(query.actor);
  return {
    action,
    type,
    actor: actorRaw && UUID_RE.test(actorRaw) ? actorRaw.toLowerCase() : null,
    from: parseAuditDate(query.from),
    to: parseAuditDate(query.to),
  };
}

/** Actions offered for a type filter (all Space actions when no type is chosen). */
export function auditActionGroupsFor(type: SpaceAuditActionGroup | null | undefined) {
  return type
    ? SPACE_AUDIT_ACTION_GROUPS.filter((g) => g.group === type)
    : SPACE_AUDIT_ACTION_GROUPS;
}

/** Inclusive start of the `from` day, as an ISO instant with offset. */
export function auditFromIso(date: string): string {
  return `${date}T00:00:00${DISPLAY_OFFSET}`;
}

/** Exclusive end for an inclusive `to` day: the start of the next day. */
export function auditToIso(date: string): string {
  const m = DATE_RE.exec(date)!;
  const next = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  return `${next.toISOString().slice(0, 10)}T00:00:00${DISPLAY_OFFSET}`;
}

/** Filters → input of `listAuditLogs` (`actions`, `entityTypes`, `actorId`, `from`, `to`). */
export function auditFiltersToQuery(filters: AuditFilters) {
  return {
    actions: filters.action ? [filters.action] : undefined,
    entityTypes: filters.type ? [filters.type] : undefined,
    actorId: filters.actor ?? undefined,
    from: filters.from ? auditFromIso(filters.from) : undefined,
    to: filters.to ? auditToIso(filters.to) : undefined,
  };
}

export function hasAuditFilters(filters: AuditFilters): boolean {
  return Boolean(filters.action || filters.type || filters.actor || filters.from || filters.to);
}

/** URL of the audit page with the given filters and page. */
export function auditPageHref(
  base: string,
  { cursor, ...filters }: AuditFilters & { cursor?: string | null },
): string {
  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.action) params.set("action", filters.action);
  if (filters.actor) params.set("actor", filters.actor);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** `GET /api/audit/export` URL for a Space with the same filters as the list (T6.4a). */
export function auditExportHref(spaceId: string, filters: AuditFilters): string {
  const q = auditFiltersToQuery(filters);
  const params = new URLSearchParams({ space: spaceId });
  if (filters.type) params.set("type", filters.type);
  if (filters.action) params.set("action", filters.action);
  if (q.actorId) params.set("actor", q.actorId);
  if (q.from) params.set("from", q.from);
  if (q.to) params.set("to", q.to);
  return `/api/audit/export?${params.toString()}`;
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
