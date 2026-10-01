import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Page search contract (task T5.2, docs/PLAN.md §4.4). Wraps the `search_pages` RPC: accent-
 * insensitive websearch (`"phrase"`, `-exclude`, `or`) with a prefix match on the last word and a
 * typo-tolerant title match. The RPC is SECURITY INVOKER, so RLS limits results to live pages of
 * Spaces the caller can view, and it is rate limited per user (`RATE_LIMITED`).
 *
 * Errors are thrown as {@link SearchError}; the UI shows `errors.<code>`. Example:
 *
 * ```ts
 * const supabase = await createClient();
 * const { results } = await searchPages(supabase, { q: "nghi phep", limit: 20 });
 * // [{ pageId: "2000…0001", spaceId: "1000…000a", title: "Quy trình nghỉ phép",
 * //    snippetHtml: "Nhân viên được <mark>nghỉ</mark> <mark>phép</mark> 12 ngày",
 * //    matchIn: "title", score: 1.31, lastEditedAt: "2026-09-26T09:00:00+00:00" }]
 * ```
 *
 * `snippetHtml` is already sanitized: everything is HTML-escaped except the `<mark>` tags.
 */

export const SEARCH_ERROR_CODES = [
  "FORBIDDEN",
  "RATE_LIMITED",
  "SEARCH_FAILED",
  "UNAUTHORIZED",
  "VALIDATION_FAILED",
] as const;
export type SearchErrorCode = (typeof SEARCH_ERROR_CODES)[number];

export class SearchError extends Error {
  constructor(
    readonly code: SearchErrorCode,
    options?: { cause?: unknown; retryAfterSeconds?: number },
  ) {
    super(code, options);
    this.name = "SearchError";
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }

  /** Seconds until the rate limit window resets (only for `RATE_LIMITED`). */
  readonly retryAfterSeconds?: number;
}

export const SEARCH_MATCH_IN = ["title", "heading", "body", "table"] as const;
export type SearchMatchIn = (typeof SEARCH_MATCH_IN)[number];

export const SEARCH_MAX_QUERY_LENGTH = 200;
export const SEARCH_MAX_LIMIT = 50;
export const SEARCH_DEFAULT_LIMIT = 20;

export const searchPagesInputSchema = z.object({
  q: z.string().trim().min(1).max(SEARCH_MAX_QUERY_LENGTH),
  spaceIds: z.array(z.uuid()).max(100).optional(),
  limit: z.number().int().min(1).max(SEARCH_MAX_LIMIT).default(SEARCH_DEFAULT_LIMIT),
  offset: z.number().int().min(0).max(10_000).default(0),
});
export type SearchPagesInput = z.input<typeof searchPagesInputSchema>;

export const searchResultSchema = z.object({
  pageId: z.uuid(),
  spaceId: z.uuid(),
  title: z.string(),
  snippetHtml: z.string(),
  matchIn: z.enum(SEARCH_MATCH_IN),
  score: z.number(),
  lastEditedAt: z.string(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchPagesOutputSchema = z.object({ results: z.array(searchResultSchema) });
export type SearchPagesOutput = z.infer<typeof searchPagesOutputSchema>;

const rowSchema = z.object({
  page_id: z.uuid(),
  space_id: z.uuid(),
  title: z.string(),
  snippet: z.string().nullable(),
  match_in: z.enum(SEARCH_MATCH_IN),
  score: z.number(),
  last_edited_at: z.string(),
});

/** The only database surface this module uses (`supabase.rpc`), so tests can script it. */
export type SearchDb = Pick<SupabaseClient, "rpc" | "auth">;

/** Escapes everything, then restores the `<mark>` tags `ts_headline` added. */
export function sanitizeSnippet(snippet: string): string {
  return snippet
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/&lt;mark&gt;/g, "<mark>")
    .replace(/&lt;\/mark&gt;/g, "</mark>");
}

export async function searchPages(
  db: SearchDb,
  rawInput: SearchPagesInput,
): Promise<SearchPagesOutput> {
  const parsed = searchPagesInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new SearchError("VALIDATION_FAILED", { cause: parsed.error });
  const input = parsed.data;

  const { data, error } = await db.rpc("search_pages", {
    q: input.q,
    space_ids: input.spaceIds?.length ? input.spaceIds : null,
    limit: input.limit,
    offset: input.offset,
  });
  if (error) throw toSearchError(error);

  const rows = z.array(rowSchema).safeParse(data ?? []);
  if (!rows.success) throw new SearchError("SEARCH_FAILED", { cause: rows.error });
  return {
    results: rows.data.map((row) => ({
      pageId: row.page_id,
      spaceId: row.space_id,
      title: row.title,
      snippetHtml: sanitizeSnippet(row.snippet ?? ""),
      matchIn: row.match_in,
      score: row.score,
      lastEditedAt: row.last_edited_at,
    })),
  };
}

const PG_INSUFFICIENT_PRIVILEGE = "42501";

/** DB error → code: `RATE_LIMITED` (raised by the RPC, hint = seconds), privilege → FORBIDDEN. */
export function toSearchError(error: unknown): SearchError {
  if (error instanceof SearchError) return error;
  const { code, message, hint } = (error ?? {}) as {
    code?: string;
    message?: string;
    hint?: string;
  };
  if (message === "RATE_LIMITED") {
    const seconds = Number.parseInt(hint ?? "", 10);
    return new SearchError("RATE_LIMITED", {
      cause: error,
      retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : undefined,
    });
  }
  if (code === PG_INSUFFICIENT_PRIVILEGE) return new SearchError("FORBIDDEN", { cause: error });
  return new SearchError("SEARCH_FAILED", { cause: error });
}
