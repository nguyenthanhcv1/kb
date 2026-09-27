import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { keyBetween } from "./position";

/**
 * Page tree contract (task T2.2, docs/PLAN.md §3.2 `pages`, §9 M2).
 *
 * Every function takes the caller's Supabase client (`createClient()` from `@/lib/supabase/server`)
 * so RLS decides what is allowed; tree invariants (same Space, no cycles, subtree trash/restore,
 * purge only from the trash) are enforced by triggers from T2.1. Server Actions wrapping these
 * functions live in `./actions.ts`.
 *
 * Errors are thrown as {@link PageError} with a code from {@link PAGE_ERROR_CODES}; the UI shows
 * `errors.<code>`. Example (Server Component):
 *
 * ```ts
 * const supabase = await createClient();
 * const roots = await listChildPages(supabase, { spaceId, parentId: null });
 * // [{ id: "2000…0001", shortId: "a1B2c3D4", slug: "huong-dan", title: "Hướng dẫn", icon: "📘",
 * //    parentId: null, position: "V", hasChildren: true, lastEditedAt: "2026-09-26T09:00:00+00:00" }]
 * const page = await createPage(supabase, { spaceId, parentId: roots[0].id, title: "Nghỉ phép" });
 * await movePage(supabase, { pageId: page.id, parentId: null, afterId: roots[0].id });
 * ```
 */

export const PAGE_ERROR_CODES = [
  "FORBIDDEN",
  "PAGE_ACTION_FAILED",
  "PAGE_DELETED",
  "PAGE_MOVE_CYCLE",
  "PAGE_NOT_FOUND",
  "PAGE_NOT_IN_TRASH",
  "PAGE_PARENT_DELETED",
  "PAGE_PARENT_NOT_FOUND",
  "PAGE_PARENT_SPACE_MISMATCH",
  "VALIDATION_FAILED",
] as const;
export type PageErrorCode = (typeof PAGE_ERROR_CODES)[number];

export class PageError extends Error {
  constructor(
    readonly code: PageErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = "PageError";
  }
}

/** Title length limit (UI input `maxLength`). */
export const PAGE_TITLE_MAX_LENGTH = 255;

const title = z
  .string()
  .max(PAGE_TITLE_MAX_LENGTH)
  .transform((value) => value.normalize("NFC").replace(/\s+/g, " ").trim());

export const listChildPagesInputSchema = z.object({
  spaceId: z.guid(),
  /** `null` = root pages of the Space. */
  parentId: z.guid().nullable(),
});
export type ListChildPagesInput = z.input<typeof listChildPagesInputSchema>;

export const createPageInputSchema = z.object({
  spaceId: z.guid(),
  parentId: z.guid().nullable().default(null),
  title: title.default(""),
  icon: z.string().max(64).nullable().optional(),
  /** Sibling to insert after; `null` = first; omitted = last. */
  afterId: z.guid().nullable().optional(),
});
export type CreatePageInput = z.input<typeof createPageInputSchema>;

export const renamePageInputSchema = z.object({
  pageId: z.guid(),
  title,
  icon: z.string().max(64).nullable().optional(),
});
export type RenamePageInput = z.input<typeof renamePageInputSchema>;

export const movePageInputSchema = z.object({
  pageId: z.guid(),
  /** New parent; `null` = root of the Space. */
  parentId: z.guid().nullable(),
  /** Root moves to another Space (ignored when `parentId` is set: the parent decides). */
  spaceId: z.guid().optional(),
  /** Sibling to place the page after; `null` = first; omitted = last. */
  afterId: z.guid().nullable().optional(),
});
export type MovePageInput = z.input<typeof movePageInputSchema>;

export const pageIdInputSchema = z.object({ pageId: z.guid() });
export type PageIdInput = z.input<typeof pageIdInputSchema>;

export const listTrashInputSchema = z.object({ spaceId: z.guid() });
export type ListTrashInput = z.input<typeof listTrashInputSchema>;

export const pageSummarySchema = z.object({
  id: z.guid(),
  spaceId: z.guid(),
  parentId: z.guid().nullable(),
  /** 8 base62 chars; URLs use `/s/<space>/p/<slug>-<shortId>`. */
  shortId: z.string(),
  slug: z.string(),
  /** User content, not translated. Empty = untitled (UI shows `tree.untitled`). */
  title: z.string(),
  icon: z.string().nullable(),
  position: z.string(),
  /** ISO 8601 (UTC). */
  lastEditedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type PageSummary = z.infer<typeof pageSummarySchema>;

export type PageTreeNode = PageSummary & { hasChildren: boolean };

const PAGE_COLUMNS =
  "id, space_id, parent_id, short_id, slug, title, icon, position, last_edited_at, deleted_at";

const pageRowSchema = z
  .object({
    id: z.string(),
    space_id: z.string(),
    parent_id: z.string().nullable(),
    short_id: z.string(),
    slug: z.string(),
    title: z.string(),
    icon: z.string().nullable(),
    position: z.string(),
    last_edited_at: z.string(),
    deleted_at: z.string().nullable(),
  })
  .transform((row): PageSummary => ({
    id: row.id,
    spaceId: row.space_id,
    parentId: row.parent_id,
    shortId: row.short_id,
    slug: row.slug,
    title: row.title,
    icon: row.icon,
    position: row.position,
    lastEditedAt: row.last_edited_at,
    deletedAt: row.deleted_at,
  }));

type PostgrestErrorLike = { code?: string; message?: string } | null;

const TRIGGER_CODES = new Set<PageErrorCode>([
  "PAGE_DELETED",
  "PAGE_MOVE_CYCLE",
  "PAGE_NOT_IN_TRASH",
  "PAGE_PARENT_DELETED",
  "PAGE_PARENT_NOT_FOUND",
  "PAGE_PARENT_SPACE_MISMATCH",
]);

/** DB error → code: trigger codes pass through, privilege/RLS errors become FORBIDDEN. */
export function toPageError(error: PostgrestErrorLike | unknown): PageError {
  if (error instanceof PageError) return error;
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  if (message && TRIGGER_CODES.has(message as PageErrorCode)) {
    return new PageError(message as PageErrorCode, { cause: error });
  }
  if (code === "42501") return new PageError("FORBIDDEN", { cause: error });
  if (code === "22P02" || code === "23514")
    return new PageError("VALIDATION_FAILED", { cause: error });
  if (code === "23503") return new PageError("PAGE_PARENT_NOT_FOUND", { cause: error });
  return new PageError("PAGE_ACTION_FAILED", { cause: error });
}

function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new PageError("VALIDATION_FAILED", { cause: result.error });
  return result.data;
}

function parseRows(rows: unknown): PageSummary[] {
  return z.array(pageRowSchema).parse(rows ?? []);
}

/** Page visible to the caller (live pages; trashed ones only for editors), or null. */
export async function getPageSummary(
  supabase: SupabaseClient,
  pageId: string,
): Promise<PageSummary | null> {
  const { data, error } = await supabase
    .from("pages")
    .select(PAGE_COLUMNS)
    .eq("id", pageId)
    .maybeSingle();
  if (error) throw toPageError(error);
  return data ? pageRowSchema.parse(data) : null;
}

async function requirePage(supabase: SupabaseClient, pageId: string): Promise<PageSummary> {
  const page = await getPageSummary(supabase, pageId);
  if (!page) throw new PageError("PAGE_NOT_FOUND");
  return page;
}

/** Live children in order (sidebar tree, lazy per level). */
export async function listChildPages(
  supabase: SupabaseClient,
  input: ListChildPagesInput,
): Promise<PageTreeNode[]> {
  const { spaceId, parentId } = parseInput(listChildPagesInputSchema, input);
  let query = supabase
    .from("pages")
    .select(PAGE_COLUMNS)
    .eq("space_id", spaceId)
    .is("deleted_at", null);
  query = parentId === null ? query.is("parent_id", null) : query.eq("parent_id", parentId);
  const { data, error } = await query
    .order("position", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw toPageError(error);
  const pages = parseRows(data);
  if (pages.length === 0) return [];

  const { data: children, error: childError } = await supabase
    .from("pages")
    .select("parent_id")
    .in(
      "parent_id",
      pages.map((page) => page.id),
    )
    .is("deleted_at", null);
  if (childError) throw toPageError(childError);
  const withChildren = new Set(
    (children ?? []).map((row) => (row as { parent_id: string }).parent_id),
  );
  return pages.map((page) => ({ ...page, hasChildren: withChildren.has(page.id) }));
}

/** Longest ancestor chain {@link listPageAncestors} follows (guards against bad data). */
export const PAGE_ANCESTORS_MAX_DEPTH = 64;

/**
 * Ancestors of a page, root first, without the page itself (breadcrumb). The chain stops at the
 * first ancestor the caller cannot see. Example: for "Nghỉ phép" under "Hướng dẫn" →
 * `[{ id: "2000…0001", title: "Hướng dẫn", parentId: null, … }]`.
 */
export async function listPageAncestors(
  supabase: SupabaseClient,
  input: PageIdInput,
): Promise<PageSummary[]> {
  const { pageId } = parseInput(pageIdInputSchema, input);
  const page = await requirePage(supabase, pageId);
  const ancestors: PageSummary[] = [];
  const seen = new Set([page.id]);
  let parentId = page.parentId;
  while (parentId && !seen.has(parentId) && ancestors.length < PAGE_ANCESTORS_MAX_DEPTH) {
    seen.add(parentId);
    const parent = await getPageSummary(supabase, parentId);
    if (!parent) break;
    ancestors.unshift(parent);
    parentId = parent.parentId;
  }
  return ancestors;
}

/** Trashed pages of a Space, newest first (editors and admins only; others get []). */
export async function listTrash(
  supabase: SupabaseClient,
  input: ListTrashInput,
): Promise<PageSummary[]> {
  const { spaceId } = parseInput(listTrashInputSchema, input);
  const { data, error } = await supabase
    .from("pages")
    .select(PAGE_COLUMNS)
    .eq("space_id", spaceId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) throw toPageError(error);
  return parseRows(data);
}

/**
 * Position for a page placed under `parentId` after sibling `afterId` (`null` = first,
 * `undefined` = last), ignoring `movingId` itself.
 */
async function positionFor(
  supabase: SupabaseClient,
  spaceId: string,
  parentId: string | null,
  afterId: string | null | undefined,
  movingId?: string,
): Promise<string> {
  const siblings = (await listChildPages(supabase, { spaceId, parentId })).filter(
    (page) => page.id !== movingId,
  );
  if (afterId === undefined) return keyBetween(siblings.at(-1)?.position ?? null, null);
  if (afterId === null) return keyBetween(null, siblings[0]?.position ?? null);

  const index = siblings.findIndex((page) => page.id === afterId);
  if (index < 0) throw new PageError("VALIDATION_FAILED");
  const before = siblings[index]!.position;
  // Equal positions (concurrent inserts) → fall back to "right after `before`".
  const next = siblings.slice(index + 1).find((page) => page.position > before)?.position ?? null;
  return keyBetween(before, next);
}

export async function createPage(
  supabase: SupabaseClient,
  input: CreatePageInput,
): Promise<PageSummary> {
  const { spaceId, parentId, title, icon, afterId } = parseInput(createPageInputSchema, input);
  const position = await positionFor(supabase, spaceId, parentId, afterId);
  const { data, error } = await supabase
    .from("pages")
    .insert({ space_id: spaceId, parent_id: parentId, title, icon: icon ?? null, position })
    .select(PAGE_COLUMNS)
    .single();
  if (error) throw toPageError(error);
  return pageRowSchema.parse(data);
}

/**
 * UPDATE through RLS: a row the caller can see but not edit comes back empty — report
 * FORBIDDEN rather than a silent no-op.
 */
async function updatePage(
  supabase: SupabaseClient,
  pageId: string,
  values: Record<string, unknown>,
): Promise<PageSummary> {
  const { data, error } = await supabase
    .from("pages")
    .update(values)
    .eq("id", pageId)
    .select(PAGE_COLUMNS);
  if (error) throw toPageError(error);
  const rows = parseRows(data);
  if (rows.length === 0) throw new PageError("FORBIDDEN");
  return rows[0]!;
}

export async function renamePage(
  supabase: SupabaseClient,
  input: RenamePageInput,
): Promise<PageSummary> {
  const { pageId, title, icon } = parseInput(renamePageInputSchema, input);
  const page = await requirePage(supabase, pageId);
  if (page.deletedAt) throw new PageError("PAGE_DELETED");
  return updatePage(supabase, pageId, icon === undefined ? { title } : { title, icon });
}

export async function movePage(
  supabase: SupabaseClient,
  input: MovePageInput,
): Promise<PageSummary> {
  const {
    pageId,
    parentId,
    spaceId: targetSpaceId,
    afterId,
  } = parseInput(movePageInputSchema, input);
  const page = await requirePage(supabase, pageId);
  if (page.deletedAt) throw new PageError("PAGE_DELETED");

  let spaceId = targetSpaceId ?? page.spaceId;
  if (parentId !== null) {
    if (parentId === pageId) throw new PageError("PAGE_MOVE_CYCLE");
    const parent = await getPageSummary(supabase, parentId);
    if (!parent) throw new PageError("PAGE_PARENT_NOT_FOUND");
    if (parent.deletedAt) throw new PageError("PAGE_PARENT_DELETED");
    spaceId = parent.spaceId;
  }

  const position = await positionFor(supabase, spaceId, parentId, afterId, pageId);
  return updatePage(supabase, pageId, { space_id: spaceId, parent_id: parentId, position });
}

/** Moves the page and its subtree to the trash (restorable together). */
export async function trashPage(
  supabase: SupabaseClient,
  input: PageIdInput,
): Promise<PageSummary> {
  const { pageId } = parseInput(pageIdInputSchema, input);
  const page = await requirePage(supabase, pageId);
  if (page.deletedAt) return page;
  return updatePage(supabase, pageId, { deleted_at: new Date().toISOString() });
}

/**
 * Restores the page with the subtree trashed together with it. When its parent is still in the
 * trash (or gone), the page comes back as the last root page of its Space.
 */
export async function restorePage(
  supabase: SupabaseClient,
  input: PageIdInput,
): Promise<PageSummary> {
  const { pageId } = parseInput(pageIdInputSchema, input);
  const page = await requirePage(supabase, pageId);
  if (!page.deletedAt) return page;

  const parent = page.parentId ? await getPageSummary(supabase, page.parentId) : null;
  if (page.parentId && (!parent || parent.deletedAt)) {
    const position = await positionFor(supabase, page.spaceId, null, undefined, pageId);
    return updatePage(supabase, pageId, { deleted_at: null, parent_id: null, position });
  }
  return updatePage(supabase, pageId, { deleted_at: null });
}

/** Deletes a trashed page and its subtree for good (Space admins only). */
export async function purgePage(supabase: SupabaseClient, input: PageIdInput): Promise<void> {
  const { pageId } = parseInput(pageIdInputSchema, input);
  const page = await requirePage(supabase, pageId);
  if (!page.deletedAt) throw new PageError("PAGE_NOT_IN_TRASH");
  const { data, error } = await supabase.from("pages").delete().eq("id", pageId).select("id");
  if (error) throw toPageError(error);
  if (!data || data.length === 0) throw new PageError("FORBIDDEN");
}
