import { z } from "zod";

import {
  AuditError,
  listAuditLogs,
  listAuditLogsInputSchema,
  type AuditDb,
  type AuditLogEntry,
} from "./index";

/**
 * CSV export of the audit log (task T6.4a) — admins only (super admin: everything; Space admin:
 * their Space, `spaceId` required). Same filters as {@link listAuditLogs} minus `cursor`/`limit`.
 *
 * ```ts
 * const out = await exportAuditLogsCsv(supabase, { spaceId, entityTypes: ["page"], from, to });
 * // out = { filename: "audit-2026-09-25.csv", rowCount: 2, truncated: false,
 * //         csv: "<BOM>occurred_at,action,entity_type,entity_id,space_id,actor_id,actor_email,actor_name,metadata\r\n…" }
 * ```
 *
 * HTTP: `GET /api/audit/export?space=<uuid>&action=page.move&type=page&actor=<uuid>&from=<iso>&to=<iso>`
 * returns a `text/csv; charset=utf-8` attachment (header `x-audit-truncated: 1` when cut at
 * {@link AUDIT_EXPORT_MAX_ROWS}); errors are `{ error: <CODE> }` and the UI shows `errors.<CODE>`.
 * Column values are raw codes (not translated) so the file is stable across locales; cells that
 * could be read as spreadsheet formulas are prefixed with `'`.
 *
 * @throws {AuditError} `UNAUTHORIZED` (not signed in), `FORBIDDEN` (not an admin of the scope),
 *   `VALIDATION_FAILED`, `AUDIT_QUERY_FAILED`.
 */

export const AUDIT_EXPORT_MAX_ROWS = 10_000;
const PAGE = 100;
const BOM = String.fromCharCode(0xfeff);

export const AUDIT_CSV_COLUMNS = [
  "occurred_at",
  "action",
  "entity_type",
  "entity_id",
  "space_id",
  "actor_id",
  "actor_email",
  "actor_name",
  "metadata",
] as const;

export const exportAuditLogsInputSchema = listAuditLogsInputSchema.omit({
  cursor: true,
  limit: true,
});
export type ExportAuditLogsInput = z.input<typeof exportAuditLogsInputSchema>;

export const exportAuditLogsOutputSchema = z.object({
  /** UTF-8 with BOM (Excel), CRLF line endings, header row first. */
  csv: z.string(),
  /** `audit-<UTC date>.csv` */
  filename: z.string(),
  rowCount: z.number().int(),
  /** More rows matched than {@link AUDIT_EXPORT_MAX_ROWS}; narrow the filters. */
  truncated: z.boolean(),
});
export type ExportAuditLogsOutput = z.infer<typeof exportAuditLogsOutputSchema>;

/** Escapes one CSV cell (RFC 4180) and neutralizes spreadsheet formula injection. */
export function csvCell(value: string | null | undefined): string {
  let text = value ?? "";
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function auditEntryToCsvRow(entry: AuditLogEntry): string {
  return [
    entry.occurredAt,
    entry.action,
    entry.entityType,
    entry.entityId,
    entry.spaceId,
    entry.actor?.id,
    entry.actor?.email,
    entry.actor?.fullName,
    JSON.stringify(entry.metadata),
  ]
    .map(csvCell)
    .join(",");
}

export function auditEntriesToCsv(entries: AuditLogEntry[]): string {
  const lines = [AUDIT_CSV_COLUMNS.join(","), ...entries.map(auditEntryToCsvRow)];
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

type RowResult = { data: Record<string, unknown> | null; error: { message: string } | null };

/** The part of a Supabase client the admin check needs (a `SupabaseClient` satisfies it). */
export interface AuditExportDb extends AuditDb {
  auth: { getUser(): PromiseLike<{ data: { user: { id: string } | null } }> };
  from(table: "profiles" | "space_members"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        eq(column: string, value: string): { maybeSingle(): PromiseLike<RowResult> };
        maybeSingle(): PromiseLike<RowResult>;
      };
    };
  };
}

async function requireAuditAdmin(db: AuditExportDb, spaceId: string | undefined): Promise<void> {
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new AuditError("UNAUTHORIZED");
  const profile = await db
    .from("profiles")
    .select("is_super_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (profile.error) throw new AuditError("AUDIT_QUERY_FAILED", { cause: profile.error });
  if (profile.data?.is_super_admin === true) return;
  if (!spaceId) throw new AuditError("FORBIDDEN");
  const member = await db
    .from("space_members")
    .select("role")
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (member.error) throw new AuditError("AUDIT_QUERY_FAILED", { cause: member.error });
  if (member.data?.role !== "admin") throw new AuditError("FORBIDDEN");
}

export async function exportAuditLogsCsv(
  db: AuditExportDb,
  input: ExportAuditLogsInput = {},
  now: Date = new Date(),
): Promise<ExportAuditLogsOutput> {
  const parsed = exportAuditLogsInputSchema.safeParse(input);
  if (!parsed.success) throw new AuditError("VALIDATION_FAILED", { cause: parsed.error });
  await requireAuditAdmin(db, parsed.data.spaceId);

  const entries: AuditLogEntry[] = [];
  let cursor: string | undefined;
  let truncated = false;
  for (;;) {
    const page = await listAuditLogs(db, { ...parsed.data, cursor, limit: PAGE });
    entries.push(...page.entries);
    if (!page.nextCursor) break;
    if (entries.length >= AUDIT_EXPORT_MAX_ROWS) {
      truncated = true;
      break;
    }
    cursor = page.nextCursor;
  }
  return {
    csv: auditEntriesToCsv(entries),
    filename: `audit-${now.toISOString().slice(0, 10)}.csv`,
    rowCount: entries.length,
    truncated,
  };
}
