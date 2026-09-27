import { createClient } from "@/lib/supabase/server";

import {
  AuditError,
  listAuditLogs,
  type AuditDb,
  type AuditErrorCode,
  type AuditLogEntry,
  type ListAuditLogsInput,
  type ListAuditLogsOutput,
} from "./index";

/**
 * Server-side reads of the audit log for the UI (T1.6b), on top of the T1.6a contract
 * (`./index.ts`). Called from Server Components with a caller-scoped Supabase client — RLS decides
 * what is visible (space admins: their spaces; super admins: everything).
 */

/** A person an entry is about (`metadata.user_id`: the member added, removed, re-roled…). */
export type AuditPerson = { id: string; email: string | null; fullName: string | null };

export type AuditPageData = ListAuditLogsOutput & {
  /** Profiles of the people referenced in `metadata.user_id`, by id (missing when not visible). */
  people: Record<string, AuditPerson>;
};

export type AuditQueryResult =
  { ok: true; data: AuditPageData } | { ok: false; error: AuditErrorCode };

/** The narrow part of a Supabase client used to look up referenced profiles. */
export interface AuditPeopleDb {
  from(table: "profiles"): {
    select(columns: "id, email, full_name"): {
      in(
        column: "id",
        values: string[],
      ): PromiseLike<{
        data: { id: string; email: string | null; full_name: string | null }[] | null;
        error: { message: string } | null;
      }>;
    };
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Distinct `metadata.user_id` values of the entries (actors already come with the RPC row). */
export function referencedUserIds(entries: Pick<AuditLogEntry, "metadata">[]): string[] {
  const ids = new Set<string>();
  for (const { metadata } of entries) {
    const id = metadata.user_id;
    if (typeof id === "string" && UUID.test(id)) ids.add(id.toLowerCase());
  }
  return [...ids];
}

/** Best effort: a profile the caller may not read (RLS) or a lookup error just stays unnamed. */
export async function loadAuditPeople(
  db: AuditPeopleDb,
  ids: string[],
): Promise<Record<string, AuditPerson>> {
  if (ids.length === 0) return {};
  const { data, error } = await db.from("profiles").select("id, email, full_name").in("id", ids);
  if (error || !data) {
    if (error) console.error("[audit] profile lookup failed", error.message);
    return {};
  }
  return Object.fromEntries(
    data.map((row) => [row.id, { id: row.id, email: row.email, fullName: row.full_name }]),
  );
}

/** One page of audit entries plus the referenced people, as a serializable result. */
export async function listAuditLogPage(input: ListAuditLogsInput): Promise<AuditQueryResult> {
  const supabase = await createClient();
  try {
    const page = await listAuditLogs(supabase as unknown as AuditDb, input);
    const people = await loadAuditPeople(
      supabase as unknown as AuditPeopleDb,
      referencedUserIds(page.entries),
    );
    return { ok: true, data: { ...page, people } };
  } catch (error) {
    if (error instanceof AuditError) {
      if (error.code === "AUDIT_QUERY_FAILED") console.error("[audit] list failed", error.cause);
      return { ok: false, error: error.code };
    }
    throw error;
  }
}
