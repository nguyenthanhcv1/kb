import { z } from "zod";

/**
 * Audit log contract (task T1.6a, docs/PLAN.md §3.2 `audit_logs`).
 *
 * Rows are written only by DB triggers (`app.audit_*`), never by the app. This module reads them
 * through the SQL function `public.list_audit_logs`, which is SECURITY INVOKER: RLS decides what the
 * caller sees (space admins see their spaces, super admins see everything incl. system entries).
 *
 * Usage from a Server Component / Server Action (client from `@/lib/supabase`, T1.2a):
 *
 * ```ts
 * const page = await listAuditLogs(supabase, { spaceId, actions: ["member.role_change"], limit: 50 });
 * // next page:
 * await listAuditLogs(supabase, { spaceId, cursor: page.nextCursor });
 * // extended filters (T6.4a): by kind of thing, person and time range
 * await listAuditLogs(supabase, { spaceId, entityTypes: ["page", "version"], actorId, from, to });
 * ```
 *
 * Labels: `audit.actions.<action with "." → "_">` (see {@link auditActionMessageKey}) and
 * `audit.entityTypes.<entityType>`. Errors: `errors.<AuditErrorCode>`.
 */

/** Every action code the DB writes (or will write, for pages/versions in T2.1/T3.4/T6.3). */
export const AUDIT_ACTIONS = [
  "access.add",
  "access.remove",
  "access.update",
  "invitation.accept",
  "invitation.create",
  "invitation.revoke",
  "member.add",
  "member.remove",
  "member.role_change",
  "page.create",
  "page.delete",
  "page.move",
  "page.purge",
  "page.restore_from_trash",
  "page.update_content",
  "page.update_title",
  "settings.update",
  "space.archive",
  "space.create",
  "space.unarchive",
  "space.update",
  "user.deactivate",
  "user.reactivate",
  "user.super_admin_grant",
  "user.super_admin_revoke",
  "version.restore",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITY_TYPES = [
  "access_entry",
  "invitation",
  "member",
  "page",
  "settings",
  "space",
  "user",
  "version",
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/** Entity type each action is written for (the DB `entity_type` column). */
export const AUDIT_ACTION_ENTITY_TYPE: Record<AuditAction, AuditEntityType> = {
  "access.add": "access_entry",
  "access.remove": "access_entry",
  "access.update": "access_entry",
  "invitation.accept": "invitation",
  "invitation.create": "invitation",
  "invitation.revoke": "invitation",
  "member.add": "member",
  "member.remove": "member",
  "member.role_change": "member",
  "page.create": "page",
  "page.delete": "page",
  "page.move": "page",
  "page.purge": "page",
  "page.restore_from_trash": "page",
  "page.update_content": "page",
  "page.update_title": "page",
  "settings.update": "settings",
  "space.archive": "space",
  "space.create": "space",
  "space.unarchive": "space",
  "space.update": "space",
  "user.deactivate": "user",
  "user.reactivate": "user",
  "user.super_admin_grant": "user",
  "user.super_admin_revoke": "user",
  "version.restore": "version",
};

/** Actions written for the given entity types (the "type" filter of the audit UI). */
export function auditActionsForEntityTypes(types: readonly AuditEntityType[]): AuditAction[] {
  return AUDIT_ACTIONS.filter((action) => types.includes(AUDIT_ACTION_ENTITY_TYPE[action]));
}

export const AUDIT_ERROR_CODES = [
  "AUDIT_QUERY_FAILED",
  "FORBIDDEN",
  "UNAUTHORIZED",
  "VALIDATION_FAILED",
] as const;
export type AuditErrorCode = (typeof AUDIT_ERROR_CODES)[number];

export class AuditError extends Error {
  constructor(
    readonly code: AuditErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = "AuditError";
  }
}

export const auditActionSchema = z.enum(AUDIT_ACTIONS);

/** `"member.role_change"` → `"actions.member_role_change"` (key in the `audit` namespace). */
export function auditActionMessageKey(action: AuditAction): `actions.${string}` {
  return `actions.${action.replace(".", "_")}`;
}

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

export const listAuditLogsInputSchema = z.object({
  /** Omit for the system-wide view (super admin: `/admin/audit`). */
  spaceId: z.guid().optional(),
  actions: z.array(auditActionSchema).min(1).max(AUDIT_ACTIONS.length).optional(),
  actorId: z.guid().optional(),
  /**
   * Filter by kind of thing (`page`, `member`…); combined with `actions` by intersection.
   * Unknown/empty values → `VALIDATION_FAILED`.
   */
  entityTypes: z.array(z.enum(AUDIT_ENTITY_TYPES)).min(1).max(AUDIT_ENTITY_TYPES.length).optional(),
  entityId: z.guid().optional(),
  /** Inclusive lower bound, ISO 8601 with offset. */
  from: z.iso.datetime({ offset: true }).optional(),
  /** Exclusive upper bound, ISO 8601 with offset. */
  to: z.iso.datetime({ offset: true }).optional(),
  /** `nextCursor` of the previous page. */
  cursor: z.string().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type ListAuditLogsInput = z.input<typeof listAuditLogsInputSchema>;

export const auditActorSchema = z.object({
  id: z.guid(),
  /** `null` when the profile is gone or not visible to the caller. */
  email: z.string().nullable(),
  fullName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type AuditActor = z.infer<typeof auditActorSchema>;

export const auditLogEntrySchema = z.object({
  id: z.number().int(),
  /** ISO 8601 (UTC); format it with next-intl in the viewer's time zone. */
  occurredAt: z.string(),
  /** Usually an {@link AuditAction}; unknown codes (newer DB) must still render (fallback label). */
  action: z.string(),
  entityType: z.string(),
  entityId: z.guid().nullable(),
  spaceId: z.guid().nullable(),
  /**
   * Shape per action (all ids are uuids, roles are `space_role` codes):
   * - `space.create`: `{ name, slug, visibility }`
   * - `space.update` / `settings.update`: `{ changes: { <column>: { from, to } } }`
   * - `space.archive` / `space.unarchive`: `{ name }`
   * - `member.add`: `{ user_id, role }` · `member.role_change`: `{ user_id, from_role, to_role }`
   * - `member.remove`: `{ user_id, role, self }` (`self` = the member left by themselves)
   * - `invitation.create`: `{ email, role, expires_at }` · `invitation.revoke`: `{ email, role }`
   * - `invitation.accept`: `{ email, role, user_id }`
   * - `access.add` / `access.remove`: `{ kind, value, note }` · `access.update`: `{ kind, value, changes }`
   */
  metadata: z.record(z.string(), z.unknown()),
  /** `null` for system writes without an actor (migrations, jobs that set no `app.actor_id`). */
  actor: auditActorSchema.nullable(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export const listAuditLogsOutputSchema = z.object({
  entries: z.array(auditLogEntrySchema),
  /** Pass back as `cursor` for the next (older) page; `null` on the last page. */
  nextCursor: z.string().nullable(),
});
export type ListAuditLogsOutput = z.infer<typeof listAuditLogsOutputSchema>;

/** Example output — base for the UI mock (`apps/web/src/server/audit/mock.ts`, T1.6b). */
export const listAuditLogsExample: ListAuditLogsOutput = {
  entries: [
    {
      id: 42,
      occurredAt: "2026-09-25T03:15:00.123+00:00",
      action: "member.role_change",
      entityType: "member",
      entityId: "7c1e0000-0000-4000-8000-000000000003",
      spaceId: "0b9a0000-0000-4000-8000-000000000001",
      metadata: {
        user_id: "7c1e0000-0000-4000-8000-000000000003",
        from_role: "viewer",
        to_role: "editor",
      },
      actor: {
        id: "5d2f0000-0000-4000-8000-000000000002",
        email: "an.nguyen@example.com",
        fullName: "An Nguyễn",
        avatarUrl: null,
      },
    },
  ],
  nextCursor: null,
};

/** Arguments of the SQL function `public.list_audit_logs`. */
export interface ListAuditLogsRpcArgs {
  p_space_id?: string;
  p_actions?: string[];
  p_actor_id?: string;
  p_entity_id?: string;
  p_from?: string;
  p_to?: string;
  p_before_occurred_at?: string;
  p_before_id?: number;
  p_limit: number;
}

/** The part of a Supabase client this module needs (a `SupabaseClient` satisfies it). */
export interface AuditDb {
  rpc(
    fn: "list_audit_logs",
    args: ListAuditLogsRpcArgs,
  ): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
}

const rpcRowSchema = z.object({
  id: z.coerce.number().int(),
  occurred_at: z.string(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.guid().nullable(),
  space_id: z.guid().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  actor_id: z.guid().nullable(),
  actor_email: z.string().nullable(),
  actor_full_name: z.string().nullable(),
  actor_avatar_url: z.string().nullable(),
});

const cursorSchema = z.object({
  occurredAt: z.iso.datetime({ offset: true }),
  id: z.number().int(),
});

export function encodeAuditCursor(entry: Pick<AuditLogEntry, "occurredAt" | "id">): string {
  return Buffer.from(`${entry.occurredAt}|${entry.id}`, "utf8").toString("base64url");
}

export function decodeAuditCursor(cursor: string): { occurredAt: string; id: number } {
  const [occurredAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const parsed = cursorSchema.safeParse({ occurredAt, id: Number(id) });
  if (!parsed.success) throw new AuditError("VALIDATION_FAILED", { cause: parsed.error });
  return parsed.data;
}

/**
 * Newest-first audit entries the caller may see, with keyset pagination.
 *
 * @throws {AuditError} `VALIDATION_FAILED` (bad input or cursor), `FORBIDDEN` (not signed in),
 *   `AUDIT_QUERY_FAILED` (any other DB error). A non-admin gets an empty page, not an error.
 */
export async function listAuditLogs(
  db: AuditDb,
  input: ListAuditLogsInput = {},
): Promise<ListAuditLogsOutput> {
  const parsed = listAuditLogsInputSchema.safeParse(input);
  if (!parsed.success) throw new AuditError("VALIDATION_FAILED", { cause: parsed.error });
  const { spaceId, actorId, entityId, from, to, cursor, limit, entityTypes } = parsed.data;
  let actions: readonly AuditAction[] | undefined = parsed.data.actions;
  if (entityTypes) {
    const ofTypes = auditActionsForEntityTypes(entityTypes);
    actions = actions ? actions.filter((a) => ofTypes.includes(a)) : ofTypes;
    if (actions.length === 0) return { entries: [], nextCursor: null };
  }
  const before = cursor ? decodeAuditCursor(cursor) : undefined;

  const { data, error } = await db.rpc("list_audit_logs", {
    p_space_id: spaceId,
    p_actions: actions ? [...actions] : undefined,
    p_actor_id: actorId,
    p_entity_id: entityId,
    p_from: from,
    p_to: to,
    p_before_occurred_at: before?.occurredAt,
    p_before_id: before?.id,
    // One extra row tells whether an older page exists.
    p_limit: limit + 1,
  });
  if (error) {
    throw new AuditError(error.code === "42501" ? "FORBIDDEN" : "AUDIT_QUERY_FAILED", {
      cause: error,
    });
  }

  const rows = z.array(rpcRowSchema).safeParse(data);
  if (!rows.success) throw new AuditError("AUDIT_QUERY_FAILED", { cause: rows.error });

  const entries = rows.data.slice(0, limit).map((row): AuditLogEntry => ({
    id: row.id,
    occurredAt: row.occurred_at,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    spaceId: row.space_id,
    metadata: row.metadata,
    actor: row.actor_id
      ? {
          id: row.actor_id,
          email: row.actor_email,
          fullName: row.actor_full_name,
          avatarUrl: row.actor_avatar_url,
        }
      : null,
  }));
  const last = entries.at(-1);
  return {
    entries,
    nextCursor: rows.data.length > limit && last ? encodeAuditCursor(last) : null,
  };
}
