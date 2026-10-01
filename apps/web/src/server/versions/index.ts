import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Page version history reads (task T6.2, docs/PLAN.md §3.2 `page_versions`, §3.6).
 *
 * Every function takes the caller's Supabase client so RLS decides (`page_versions_select`: anyone
 * who can see the page, guests included). Rows are written only by kb-collab (T6.1b, T6.3a); the
 * Yjs update column is never readable. Restoring is T6.3a/T6.3b, not here.
 *
 * ```ts
 * const versions = await listPageVersions(supabase, { pageId });
 * // [{ id: "3f1d…", versionNo: 12, title: "Nghỉ phép", reason: "manual", label: "Bản đã duyệt",
 * //    restoredFromVersionNo: null, createdAt: "2026-09-28T03:00:00+00:00",
 * //    createdBy: { id: "9c2e…", name: "Nguyễn Văn A" } }, …]   // newest first
 * const version = await getPageVersion(supabase, { versionId: versions[0].id });
 * // { …summary, contentJson: { type: "doc", content: [...] } }
 * ```
 *
 * Errors: {@link VersionError} (`errors.<code>`).
 */

export const VERSION_ERROR_CODES = [
  "FORBIDDEN",
  "PAGE_ACTION_FAILED",
  "VALIDATION_FAILED",
  "VERSION_NOT_FOUND",
] as const;
export type VersionErrorCode = (typeof VERSION_ERROR_CODES)[number];

export class VersionError extends Error {
  constructor(
    readonly code: VersionErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = "VersionError";
  }
}

/** Values of the DB enum `version_reason` (labels: `history.reasons.<reason>`). */
export const VERSION_REASONS = ["auto", "manual", "pre_restore", "restore"] as const;
export type VersionReason = (typeof VERSION_REASONS)[number];

/** Upper bound of one listing; older versions are pruned by retention anyway. */
export const VERSION_LIST_LIMIT = 200;

export const listPageVersionsInputSchema = z.object({ pageId: z.guid() });
export type ListPageVersionsInput = z.input<typeof listPageVersionsInputSchema>;

export const getPageVersionInputSchema = z.object({ versionId: z.guid() });
export type GetPageVersionInput = z.input<typeof getPageVersionInputSchema>;

export type VersionAuthor = {
  id: string;
  /** `null` when the profile has no name or RLS hides it: show the e-mail or `history.unknownAuthor`. */
  name: string | null;
  email: string | null;
};

export type PageVersionSummary = {
  id: string;
  /** 1, 2, … within the page. */
  versionNo: number;
  title: string;
  reason: VersionReason;
  /** Name given to a `manual` version. */
  label: string | null;
  /** `versionNo` of the source version for `restore` entries. */
  restoredFromVersionNo: number | null;
  /** ISO 8601 (UTC). */
  createdAt: string;
  /** `null` for system snapshots or a deleted user. */
  createdBy: VersionAuthor | null;
};

export type PageVersionContent = {
  /** ProseMirror JSON of the shared editor schema (`EDITOR_SCHEMA_VERSION` = `schemaVersion`). */
  type: string;
  content?: unknown[];
} & Record<string, unknown>;

export type PageVersionDetail = PageVersionSummary & {
  contentJson: PageVersionContent;
  schemaVersion: number;
};

const SUMMARY_COLUMNS =
  "id, version_no, title, reason, label, restored_from_version_id, created_by, created_at";

const summaryRowSchema = z.object({
  id: z.string(),
  version_no: z.number(),
  title: z.string(),
  reason: z.enum(VERSION_REASONS),
  label: z.string().nullable(),
  restored_from_version_id: z.string().nullable(),
  created_by: z.string().nullable(),
  created_at: z.string(),
});

const authorRowSchema = z.object({
  id: z.string(),
  full_name: z.string().nullable(),
  email: z.string().nullable(),
});

function toVersionError(error: unknown): VersionError {
  if (error instanceof VersionError) return error;
  const { code } = (error ?? {}) as { code?: string };
  if (code === "42501") return new VersionError("FORBIDDEN", { cause: error });
  if (code === "22P02") return new VersionError("VALIDATION_FAILED", { cause: error });
  return new VersionError("PAGE_ACTION_FAILED", { cause: error });
}

async function loadAuthors(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, VersionAuthor>> {
  const authors = new Map<string, VersionAuthor>();
  if (ids.length === 0) return authors;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", ids);
  // Names are a nicety: a failure or a profile hidden by RLS must not hide the history.
  if (error) return authors;
  for (const row of z.array(authorRowSchema).parse(data ?? [])) {
    authors.set(row.id, { id: row.id, name: row.full_name, email: row.email });
  }
  return authors;
}

function toSummaries(
  rows: z.infer<typeof summaryRowSchema>[],
  authors: Map<string, VersionAuthor>,
  versionNoById: Map<string, number>,
): PageVersionSummary[] {
  return rows.map((row) => ({
    id: row.id,
    versionNo: row.version_no,
    title: row.title,
    reason: row.reason,
    label: row.label,
    restoredFromVersionNo: row.restored_from_version_id
      ? (versionNoById.get(row.restored_from_version_id) ?? null)
      : null,
    createdAt: row.created_at,
    createdBy: row.created_by
      ? (authors.get(row.created_by) ?? { id: row.created_by, name: null, email: null })
      : null,
  }));
}

/** Versions of a page, newest first (at most {@link VERSION_LIST_LIMIT}). */
export async function listPageVersions(
  supabase: SupabaseClient,
  input: ListPageVersionsInput,
): Promise<PageVersionSummary[]> {
  const parsed = listPageVersionsInputSchema.safeParse(input);
  if (!parsed.success) throw new VersionError("VALIDATION_FAILED", { cause: parsed.error });
  const { data, error } = await supabase
    .from("page_versions")
    .select(SUMMARY_COLUMNS)
    .eq("page_id", parsed.data.pageId)
    .order("version_no", { ascending: false })
    .limit(VERSION_LIST_LIMIT);
  if (error) throw toVersionError(error);
  const rows = z.array(summaryRowSchema).parse(data ?? []);
  const authorIds = [...new Set(rows.flatMap((row) => (row.created_by ? [row.created_by] : [])))];
  const authors = await loadAuthors(supabase, authorIds);
  return toSummaries(rows, authors, new Map(rows.map((row) => [row.id, row.version_no])));
}

/** One version with its read-only content; `VERSION_NOT_FOUND` when missing or not visible. */
export async function getPageVersion(
  supabase: SupabaseClient,
  input: GetPageVersionInput,
): Promise<PageVersionDetail> {
  const parsed = getPageVersionInputSchema.safeParse(input);
  if (!parsed.success) throw new VersionError("VALIDATION_FAILED", { cause: parsed.error });
  const { data, error } = await supabase
    .from("page_versions")
    .select(`${SUMMARY_COLUMNS}, content_json, schema_version`)
    .eq("id", parsed.data.versionId)
    .maybeSingle();
  if (error) throw toVersionError(error);
  if (!data) throw new VersionError("VERSION_NOT_FOUND");
  const row = summaryRowSchema
    .extend({ content_json: z.looseObject({ type: z.string() }), schema_version: z.number() })
    .parse(data);

  let sourceNo = new Map<string, number>();
  if (row.restored_from_version_id) {
    const { data: source } = await supabase
      .from("page_versions")
      .select("id, version_no")
      .eq("id", row.restored_from_version_id)
      .maybeSingle();
    if (source) sourceNo = new Map([[source.id as string, source.version_no as number]]);
  }
  const authors = await loadAuthors(supabase, row.created_by ? [row.created_by] : []);
  const [summary] = toSummaries([row], authors, sourceNo);
  return {
    ...summary!,
    contentJson: row.content_json as PageVersionContent,
    schemaVersion: row.schema_version,
  };
}
