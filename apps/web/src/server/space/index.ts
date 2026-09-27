import { z } from "zod";

/**
 * Space contract (task T1.4a, docs/PLAN.md §3.2 `spaces`).
 *
 * Every function takes a caller-scoped Supabase client (`@/lib/supabase/server`'s `createClient()`,
 * never `@/lib/supabase/admin`): row visibility and permission checks are entirely delegated to
 * Postgres RLS (`app.can_view_space`, `app.is_space_admin`, `app.is_internal_user` — see the core
 * schema migration). This module only validates input, translates Postgres errors into stable
 * error codes, and maps rows to the shape the UI needs.
 *
 * Usage from a Server Component / Server Action (client from `@/lib/supabase/server`):
 *
 * ```ts
 * const { spaces } = await listSpaces(supabase);
 * const created = await createSpace(supabase, { slug: "design", name: "Design" });
 * await updateSpace(supabase, { id: created.id, name: "Design team" });
 * await archiveSpace(supabase, { id: created.id });
 * ```
 *
 * Errors: `errors.<SpaceErrorCode>` (see {@link SPACE_ERROR_CODES}).
 */

export const SPACE_VISIBILITIES = ["restricted", "internal"] as const;
export type SpaceVisibility = (typeof SPACE_VISIBILITIES)[number];

/** Effective role of the caller in a Space, per `app.space_role` — `null` when not visible to them. */
export const SPACE_ROLES = ["viewer", "editor", "admin"] as const;
export type SpaceRole = (typeof SPACE_ROLES)[number];

export const SPACE_ERROR_CODES = [
  "FORBIDDEN",
  "SPACE_NOT_FOUND",
  "SPACE_SLUG_TAKEN",
  "SPACE_WRITE_FAILED",
  "VALIDATION_FAILED",
] as const;
export type SpaceErrorCode = (typeof SPACE_ERROR_CODES)[number];

export class SpaceError extends Error {
  constructor(
    readonly code: SpaceErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = "SpaceError";
  }
}

/** DB check: `slug ~ '^[a-z0-9-]{2,50}$'` (citext, case-insensitive unique). */
const slugSchema = z.string().regex(/^[a-z0-9-]{2,50}$/);
/** DB check: `length(btrim(name)) > 0`. */
const nameSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => value.length > 0, "name must not be blank");
const descriptionSchema = z.string().nullable();
const iconSchema = z.string().nullable();
const visibilitySchema = z.enum(SPACE_VISIBILITIES);

export const listSpacesInputSchema = z.object({
  /** Case-insensitive substring match on `name`; empty/omitted returns every visible Space. */
  query: z.string().trim().min(1).optional(),
});
export type ListSpacesInput = z.input<typeof listSpacesInputSchema>;

export const spaceSummarySchema = z.object({
  id: z.guid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  visibility: visibilitySchema,
  aiEnabled: z.boolean(),
  createdBy: z.guid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** The caller's role in this Space (always non-null here: RLS only returns visible spaces). */
  role: z.enum(SPACE_ROLES),
});
export type SpaceSummary = z.infer<typeof spaceSummarySchema>;

export const listSpacesOutputSchema = z.object({
  spaces: z.array(spaceSummarySchema),
});
export type ListSpacesOutput = z.infer<typeof listSpacesOutputSchema>;

/** Example output — base for the UI mock (`apps/web/src/server/space/mock.ts`, T1.4b). */
export const listSpacesExample: ListSpacesOutput = {
  spaces: [
    {
      id: "0b9a0000-0000-4000-8000-000000000001",
      slug: "design",
      name: "Design",
      description: "Tài liệu và quy trình của nhóm Design",
      icon: "🎨",
      visibility: "internal",
      aiEnabled: true,
      createdBy: "5d2f0000-0000-4000-8000-000000000002",
      createdAt: "2026-09-01T02:00:00+00:00",
      updatedAt: "2026-09-01T02:00:00+00:00",
      role: "admin",
    },
  ],
};

export const createSpaceInputSchema = z.object({
  slug: slugSchema,
  name: nameSchema,
  description: descriptionSchema.optional(),
  icon: iconSchema.optional(),
  /** Omit to use `app_settings.default_space_visibility`. */
  visibility: visibilitySchema.optional(),
  /** Omit to use the table default (`true`). */
  aiEnabled: z.boolean().optional(),
});
export type CreateSpaceInput = z.input<typeof createSpaceInputSchema>;

export const updateSpaceInputSchema = z.object({
  id: z.guid(),
  slug: slugSchema.optional(),
  name: nameSchema.optional(),
  description: descriptionSchema.optional(),
  icon: iconSchema.optional(),
  visibility: visibilitySchema.optional(),
  aiEnabled: z.boolean().optional(),
});
export type UpdateSpaceInput = z.input<typeof updateSpaceInputSchema>;

export const archiveSpaceInputSchema = z.object({
  id: z.guid(),
});
export type ArchiveSpaceInput = z.input<typeof archiveSpaceInputSchema>;

/** A single Space with full detail (same shape as {@link SpaceSummary}, kept as an alias for callers). */
export type Space = SpaceSummary;

const spaceRowSchema = z.object({
  id: z.guid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  visibility: visibilitySchema,
  ai_enabled: z.boolean(),
  created_by: z.guid(),
  created_at: z.string(),
  updated_at: z.string(),
});

function mapSpaceRow(row: z.infer<typeof spaceRowSchema>, role: SpaceRole): SpaceSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    icon: row.icon,
    visibility: row.visibility,
    aiEnabled: row.ai_enabled,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    role,
  };
}

interface PostgrestError {
  code?: string;
  message: string;
}
interface PostgrestSingleResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

/**
 * Chainable subset of `PostgrestFilterBuilder` this module relies on. Postgrest's real client
 * splits the table builder (`select`/`insert`/`update`, from `PostgrestQueryBuilder`) from the
 * filter builder those return (`eq`/`ilike`/`is`/`order`/`single`/`maybeSingle`/`then`, from
 * `PostgrestFilterBuilder`) — this interface is kept two-level to match, so a real
 * `SupabaseClient` satisfies it without a cast at the call site.
 */
export interface SpaceRowsQuery {
  select<Columns extends string>(columns: Columns): SpaceRowsQuery;
  eq(column: string, value: string): SpaceRowsQuery;
  ilike(column: string, pattern: string): SpaceRowsQuery;
  is(column: string, value: null): SpaceRowsQuery;
  order(column: string, options?: { ascending?: boolean }): SpaceRowsQuery;
  single(): PromiseLike<PostgrestSingleResult<unknown>>;
  maybeSingle(): PromiseLike<PostgrestSingleResult<unknown>>;
  then<TResult1 = PostgrestSingleResult<unknown[]>, TResult2 = never>(
    onfulfilled?:
      ((value: PostgrestSingleResult<unknown[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

export interface SpaceTableQuery {
  select<Columns extends string>(columns: Columns): SpaceRowsQuery;
  insert(row: Record<string, unknown>): SpaceRowsQuery;
  update(row: Record<string, unknown>): SpaceRowsQuery;
}

interface SpaceMembersRowsQuery {
  eq(column: string, value: string): SpaceMembersRowsQuery;
  then<TResult1 = PostgrestSingleResult<unknown[]>, TResult2 = never>(
    onfulfilled?:
      ((value: PostgrestSingleResult<unknown[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

interface SpaceMembersQuery {
  select<Columns extends string>(columns: Columns): SpaceMembersRowsQuery;
}

interface ProfileRowsQuery {
  eq(column: string, value: string): ProfileRowsQuery;
  single(): PromiseLike<PostgrestSingleResult<unknown>>;
}

interface ProfileQuery {
  select<Columns extends string>(columns: Columns): ProfileRowsQuery;
}

type SpaceDbTable = "spaces" | "space_members" | "profiles";
type SpaceDbQueryFor<Table extends SpaceDbTable> = Table extends "spaces"
  ? SpaceTableQuery
  : Table extends "space_members"
    ? SpaceMembersQuery
    : ProfileQuery;

/** The part of a Supabase client this module needs (a `SupabaseClient` satisfies it). */
export interface SpaceDb {
  auth: {
    getUser(): PromiseLike<{ data: { user: { id: string } | null } }>;
  };
  from<Table extends SpaceDbTable>(table: Table): SpaceDbQueryFor<Table>;
}

const PG_UNIQUE_VIOLATION = "23505";
const PG_INSUFFICIENT_PRIVILEGE = "42501";

async function requireUserId(db: SpaceDb): Promise<string> {
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new SpaceError("FORBIDDEN");
  return user.id;
}

/**
 * Every Space the caller can currently see (active only — archived Spaces are invisible to
 * everyone under RLS, including their own admins), newest-name-first, with the caller's role.
 *
 * @throws {SpaceError} `VALIDATION_FAILED` (bad input), `FORBIDDEN` (not signed in).
 */
export async function listSpaces(
  db: SpaceDb,
  input: ListSpacesInput = {},
): Promise<ListSpacesOutput> {
  const parsed = listSpacesInputSchema.safeParse(input);
  if (!parsed.success) throw new SpaceError("VALIDATION_FAILED", { cause: parsed.error });
  const userId = await requireUserId(db);

  const [profileResult, memberResult] = await Promise.all([
    db.from("profiles").select("is_super_admin, is_guest").eq("id", userId).single(),
    db.from("space_members").select("space_id, role").eq("user_id", userId),
  ]);
  if (profileResult.error)
    throw new SpaceError("SPACE_WRITE_FAILED", { cause: profileResult.error });
  if (memberResult.error) throw new SpaceError("SPACE_WRITE_FAILED", { cause: memberResult.error });

  const profile = z
    .object({ is_super_admin: z.boolean(), is_guest: z.boolean() })
    .parse(profileResult.data);
  const memberships = z
    .array(z.object({ space_id: z.guid(), role: z.enum(SPACE_ROLES) }))
    .parse(memberResult.data ?? []);
  const roleByMemberSpace = new Map(memberships.map((m) => [m.space_id, m.role]));

  let query = db
    .from("spaces")
    .select(
      "id, slug, name, description, icon, visibility, ai_enabled, created_by, created_at, updated_at",
    )
    .is("archived_at", null)
    .order("name", { ascending: true });
  if (parsed.data.query) query = query.ilike("name", `%${parsed.data.query}%`);

  const { data, error } = await query;
  if (error) throw new SpaceError("SPACE_WRITE_FAILED", { cause: error });

  const rows = z.array(spaceRowSchema).parse(data ?? []);
  const spaces = rows.flatMap((row) => {
    const role: SpaceRole | null = profile.is_super_admin
      ? "admin"
      : (roleByMemberSpace.get(row.id) ??
        (row.visibility === "internal" && !profile.is_guest ? "viewer" : null));
    // RLS already filters to visible rows only; `role === null` should not happen, but skip
    // defensively rather than surface a Space the UI would not know how to label.
    return role ? [mapSpaceRow(row, role)] : [];
  });

  return { spaces };
}

/**
 * Creates a Space with the signed-in user as `created_by` (a DB trigger then adds them as the
 * first `admin` member).
 *
 * @throws {SpaceError} `VALIDATION_FAILED`, `FORBIDDEN` (not signed in or not an internal user —
 *   RLS `spaces_insert` requires `app.is_internal_user()`), `SPACE_SLUG_TAKEN`, `SPACE_WRITE_FAILED`.
 */
export async function createSpace(db: SpaceDb, input: CreateSpaceInput): Promise<Space> {
  const parsed = createSpaceInputSchema.safeParse(input);
  if (!parsed.success) throw new SpaceError("VALIDATION_FAILED", { cause: parsed.error });
  const userId = await requireUserId(db);

  const { data, error } = await db
    .from("spaces")
    .insert({
      slug: parsed.data.slug,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      icon: parsed.data.icon ?? null,
      ...(parsed.data.visibility ? { visibility: parsed.data.visibility } : {}),
      ...(parsed.data.aiEnabled === undefined ? {} : { ai_enabled: parsed.data.aiEnabled }),
      created_by: userId,
    })
    .select(
      "id, slug, name, description, icon, visibility, ai_enabled, created_by, created_at, updated_at",
    )
    .single();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION)
      throw new SpaceError("SPACE_SLUG_TAKEN", { cause: error });
    // A non-internal user (e.g. a guest) fails the `spaces_insert` WITH CHECK, which Postgres
    // reports as a 42501 (insufficient privilege) RLS denial.
    if (error.code === PG_INSUFFICIENT_PRIVILEGE)
      throw new SpaceError("FORBIDDEN", { cause: error });
    throw new SpaceError("SPACE_WRITE_FAILED", { cause: error });
  }

  const row = spaceRowSchema.parse(data);
  return mapSpaceRow(row, "admin");
}

async function findVisibleSpace(
  db: SpaceDb,
  id: string,
): Promise<z.infer<typeof spaceRowSchema> | null> {
  const { data, error } = await db
    .from("spaces")
    .select(
      "id, slug, name, description, icon, visibility, ai_enabled, created_by, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new SpaceError("SPACE_WRITE_FAILED", { cause: error });
  if (!data) return null;
  return spaceRowSchema.parse(data);
}

/**
 * Updates a Space's editable fields. Distinguishes, without leaking existence to callers who
 * cannot even view the Space: `SPACE_NOT_FOUND` when the caller cannot see the row at all
 * (deleted/archived/never existed/no access — `app.can_view_space` denies the SELECT the same
 * way in every case), `FORBIDDEN` when they can see it but are not a Space admin.
 *
 * @throws {SpaceError} `VALIDATION_FAILED`, `FORBIDDEN`, `SPACE_NOT_FOUND`, `SPACE_SLUG_TAKEN`,
 *   `SPACE_WRITE_FAILED`.
 */
export async function updateSpace(db: SpaceDb, input: UpdateSpaceInput): Promise<Space> {
  const parsed = updateSpaceInputSchema.safeParse(input);
  if (!parsed.success) throw new SpaceError("VALIDATION_FAILED", { cause: parsed.error });
  await requireUserId(db);

  const { id, ...fields } = parsed.data;
  const existing = await findVisibleSpace(db, id);
  if (!existing) throw new SpaceError("SPACE_NOT_FOUND");

  const patch: Record<string, unknown> = {};
  if (fields.slug !== undefined) patch.slug = fields.slug;
  if (fields.name !== undefined) patch.name = fields.name;
  if (fields.description !== undefined) patch.description = fields.description;
  if (fields.icon !== undefined) patch.icon = fields.icon;
  if (fields.visibility !== undefined) patch.visibility = fields.visibility;
  if (fields.aiEnabled !== undefined) patch.ai_enabled = fields.aiEnabled;

  // Always issue a real UPDATE, even with no changed fields: this is what runs the
  // `spaces_update` RLS check (`app.is_space_admin`). Skipping the query for an empty patch
  // would let any caller who can merely *view* the Space (not admin it) short-circuit past
  // authorization and get back a falsely-labeled `role: "admin"` response.
  const hasChanges = Object.keys(patch).length > 0;
  const { data, error } = await db
    .from("spaces")
    .update(hasChanges ? patch : { updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(
      "id, slug, name, description, icon, visibility, ai_enabled, created_by, created_at, updated_at",
    )
    .maybeSingle();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION)
      throw new SpaceError("SPACE_SLUG_TAKEN", { cause: error });
    throw new SpaceError("SPACE_WRITE_FAILED", { cause: error });
  }
  // Visible via SELECT (can_view_space) but the UPDATE matched zero rows: the stricter
  // `app.is_space_admin` check in `spaces_update`'s USING clause rejected it.
  if (!data) throw new SpaceError("FORBIDDEN");

  return mapSpaceRow(spaceRowSchema.parse(data), "admin");
}

/**
 * Archives a Space (soft-delete: RLS then hides it from everyone, admins included — there is no
 * `unarchive` in this contract, see docs/PLAN.md §3.5 `spaces`: "không (dùng archive)"). Calling
 * this twice is safe in the sense that it never corrupts state or double-writes an audit row:
 * the second call finds nothing visible to archive (RLS hides archived spaces from everyone,
 * see `app.space_role`) and throws the same `SPACE_NOT_FOUND` it would for a Space that never
 * existed — callers should treat a `SPACE_NOT_FOUND` on archive as "already archived or gone".
 *
 * @throws {SpaceError} `VALIDATION_FAILED`, `FORBIDDEN`, `SPACE_NOT_FOUND`, `SPACE_WRITE_FAILED`.
 */
export async function archiveSpace(db: SpaceDb, input: ArchiveSpaceInput): Promise<void> {
  const parsed = archiveSpaceInputSchema.safeParse(input);
  if (!parsed.success) throw new SpaceError("VALIDATION_FAILED", { cause: parsed.error });
  await requireUserId(db);

  const existing = await findVisibleSpace(db, parsed.data.id);
  if (!existing) throw new SpaceError("SPACE_NOT_FOUND");

  const { data, error } = await db
    .from("spaces")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();

  if (error) throw new SpaceError("SPACE_WRITE_FAILED", { cause: error });
  if (!data) throw new SpaceError("FORBIDDEN");
}
