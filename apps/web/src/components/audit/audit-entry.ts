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

type QueryValue = string | string[] | undefined;

function first(value: QueryValue): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw ? raw : null;
}

/** `?action=` of the Space audit page → a Space action, or `null` (all actions) when invalid. */
export function parseSpaceAuditAction(value: QueryValue): AuditAction | null {
  const raw = first(value);
  return raw && isAuditAction(raw) && SPACE_AUDIT_ACTIONS.includes(raw) ? raw : null;
}

/** `?type=` → a Space entity type, or `null` (all types) when invalid. */
export function parseSpaceAuditType(value: QueryValue): SpaceAuditActionGroup | null {
  const raw = first(value);
  return (SPACE_ACTION_GROUPS as readonly string[]).includes(raw ?? "")
    ? (raw as SpaceAuditActionGroup)
    : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day `YYYY-MM-DD` (rejects `2026-02-31`), else `null`. */
function parseDay(value: QueryValue): string | null {
  const raw = first(value);
  if (!raw || !DAY.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw ? null : raw;
}

/** `?cursor=` → the cursor string, or `null`. The contract validates it (`VALIDATION_FAILED`). */
export function parseAuditCursor(value: QueryValue): string | null {
  return first(value);
}

/** Filters of the Space audit page; `from`/`to` are inclusive days (`YYYY-MM-DD`). */
export type AuditFilters = {
  action: AuditAction | null;
  type: SpaceAuditActionGroup | null;
  actor: string | null;
  from: string | null;
  to: string | null;
};

export const NO_AUDIT_FILTERS: AuditFilters = {
  action: null,
  type: null,
  actor: null,
  from: null,
  to: null,
};

/** Reads every filter from `searchParams`; invalid values fall back to "no filter". */
export function parseAuditFilters(query: Record<string, QueryValue>): AuditFilters {
  const actor = first(query.actor);
  const from = parseDay(query.from);
  const to = parseDay(query.to);
  return {
    action: parseSpaceAuditAction(query.action),
    type: parseSpaceAuditType(query.type),
    actor: actor && UUID.test(actor) ? actor.toLowerCase() : null,
    // An inverted range would always be empty: ignore the upper bound instead.
    from,
    to: from && to && to < from ? null : to,
  };
}

export function hasAuditFilters(filters: AuditFilters): boolean {
  return Object.values(filters).some(Boolean);
}

/** Business time zone: the day filters are days in Vietnam (docs: múi giờ mặc định). */
const DAY_OFFSET = "+07:00";

/** Day range → ISO instants for the contract: `from` inclusive, `to` exclusive (next midnight). */
export function auditRange(filters: Pick<AuditFilters, "from" | "to">): {
  from?: string;
  to?: string;
} {
  const next = (day: string) => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  return {
    from: filters.from ? `${filters.from}T00:00:00${DAY_OFFSET}` : undefined,
    to: filters.to ? `${next(filters.to)}T00:00:00${DAY_OFFSET}` : undefined,
  };
}

function filterParams(filters: Partial<AuditFilters>): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.action) params.set("action", filters.action);
  if (filters.actor) params.set("actor", filters.actor);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params;
}

/** URL of the audit page with the given filters and page. */
export function auditPageHref(
  base: string,
  { cursor, ...filters }: Partial<AuditFilters> & { cursor?: string | null },
): string {
  const params = filterParams(filters);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** URL of the CSV export (T6.4a route) for the same filters, in the Space `spaceId`. */
export function auditExportHref(spaceId: string, filters: AuditFilters): string {
  const params = new URLSearchParams({ space: spaceId });
  for (const [key, value] of filterParams(filters)) params.set(key, value);
  const { from, to } = auditRange(filters);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
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
