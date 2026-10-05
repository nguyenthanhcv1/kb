import { z } from "zod";

import type { MailMessage, SendMail } from "../mail";

/**
 * Access administration contract (task T1.7a, docs/PLAN.md §3.2 `access_allowlist`, §9 T1.7) —
 * the server side of `/admin/access` and `/admin/users` (UI: T1.7b). Super admins only.
 *
 * Every function takes the caller's Supabase client (`createClient()` from
 * `@/lib/supabase/server`, never the service-role client): Postgres decides. The allowlist is
 * written through its RLS (super admin only; nobody deletes the entry of their own email) and
 * audited by trigger (`access.add` / `access.remove`); users are read and changed through the
 * SECURITY DEFINER functions of migration `*_access.sql` (`admin_list_users`,
 * `admin_set_user_deactivated`, `admin_set_super_admin`, `admin_list_access_entries`,
 * `admin_access_impact`), which re-check `app.is_super_admin()` and enforce the invariants
 * (no self-deactivation / self-demotion, one active super admin stays) for every caller.
 * Server Actions wrapping these functions: `./actions.ts`.
 *
 * Effects the UI should explain:
 * - Adding an email/domain lets matching people sign in immediately; existing guests it matches
 *   become internal users.
 * - Removing an entry (or deactivating a user) takes effect on that user's next request: the
 *   middleware re-checks `app.has_active_access` and signs them out with
 *   `/login?error=AUTH_ACCESS_REVOKED` (translated on the login page). Users who still match
 *   another entry, super admins and — as guests — Space members keep access; see
 *   {@link previewAccessRemoval}.
 *
 * ```ts
 * const supabase = await createClient();
 * const { entries } = await listAccessEntries(supabase);
 * const result = await addAccessEntries(supabase, { input: "an@ahamove.com, ahamove.com" });
 * const impact = await previewAccessRemoval(supabase, { ids: [entries[0].id] });
 * // { matchedUsers: 12, losingAccess: 3, becomingGuest: 1 }
 * await removeAccessEntries(supabase, { ids: [entries[0].id] });
 * const { users, total } = await listUsers(supabase, { query: "an", status: "active" });
 * await setUserDeactivated(supabase, { userId: users[0].id, deactivated: true });
 * ```
 *
 * Errors: {@link AdminError} with a code from {@link ADMIN_ERROR_CODES}; the UI shows
 * `errors.<code>`.
 */

export const ADMIN_ERROR_CODES = [
  "ACCESS_CANNOT_REMOVE_SELF",
  "ACCESS_ENTRY_NOT_FOUND",
  "ADMIN_ACTION_FAILED",
  "FORBIDDEN",
  "LAST_SUPER_ADMIN",
  "MAIL_NOT_CONFIGURED",
  "MAIL_SEND_FAILED",
  "USER_CANNOT_CHANGE_SELF",
  "USER_DEACTIVATED",
  "USER_IS_GUEST",
  "USER_NOT_FOUND",
  "VALIDATION_FAILED",
] as const;
export type AdminErrorCode = (typeof ADMIN_ERROR_CODES)[number];

export class AdminError extends Error {
  constructor(
    readonly code: AdminErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = "AdminError";
  }
}

// ---------------------------------------------------------------------------------------------
// Allowlist input parsing (pure — also usable client-side for a live preview)
// ---------------------------------------------------------------------------------------------

export const ACCESS_ENTRY_KINDS = ["email", "domain"] as const;
export type AccessEntryKind = (typeof ACCESS_ENTRY_KINDS)[number];

/**
 * Consumer email domains. Adding one as a *domain* entry would let anyone with such an address in
 * (docs/PLAN.md §3.2: "email Gmail cá nhân chỉ nên thêm theo từng email"), so it needs an explicit
 * confirmation ({@link AddAccessEntriesInput.allowPublicDomains}). Email entries at these domains
 * are fine.
 */
export const PUBLIC_EMAIL_DOMAINS: readonly string[] = [
  "aol.com",
  "gmail.com",
  "gmx.com",
  "googlemail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "mac.com",
  "mail.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "yahoo.com",
  "yahoo.com.vn",
  "yandex.com",
  "zoho.com",
];

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.includes(domain.trim().toLowerCase());
}

/** Max entries accepted by one {@link addAccessEntries} / {@link removeAccessEntries} call. */
export const ACCESS_BULK_MAX = 500;

/** Mirrors the `access_allowlist` check constraint (and is used for the domain part of emails). */
const DOMAIN_RE =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const EMAIL_LOCAL_RE = /^[^@\s<>(),;:"[\]\\]+$/;

export type ParsedAccessEntry = {
  /** The token as typed (trimmed). */
  raw: string;
  kind: AccessEntryKind;
  /** Normalized (lower-case) value; `null` when invalid. */
  value: string | null;
  /** `duplicate` = the same kind+value appeared earlier in the same input. */
  status: "valid" | "invalid" | "duplicate";
  /** Domain entry of a consumer email provider (see {@link PUBLIC_EMAIL_DOMAINS}). */
  publicDomain: boolean;
};

function normalizeToken(
  raw: string,
  forcedKind?: AccessEntryKind,
): Pick<ParsedAccessEntry, "kind" | "value"> {
  let token = raw
    .trim()
    .replace(/^mailto:/i, "")
    .toLowerCase();
  if (token.startsWith("@")) {
    // "@ahamove.com" is a domain.
    token = token.slice(1);
  } else if (token.includes("@")) {
    const [local = "", domain = "", ...rest] = token.split("@");
    const valid = rest.length === 0 && EMAIL_LOCAL_RE.test(local) && DOMAIN_RE.test(domain);
    if (forcedKind === "domain" || !valid) return { kind: forcedKind ?? "email", value: null };
    return { kind: "email", value: token };
  }
  if (forcedKind === "email") return { kind: "email", value: null };
  return { kind: "domain", value: DOMAIN_RE.test(token) ? token : null };
}

/**
 * Splits pasted text into allowlist entries: separators are new lines, commas, semicolons and
 * spaces; `Name <an@example.com>` keeps just the address; `@example.com` or `example.com` is a
 * domain, anything with a local part is an email. Values are lower-cased (the DB compares
 * case-insensitively). `kind` forces every token to that kind (the others become `invalid`).
 *
 * @example parseAccessEntries("An <An@Ahamove.com>; ahamove.com, gmail.com, nope")
 * // [{ raw: "An@Ahamove.com", kind: "email", value: "an@ahamove.com", status: "valid", publicDomain: false },
 * //  { raw: "ahamove.com", kind: "domain", value: "ahamove.com", status: "valid", publicDomain: false },
 * //  { raw: "gmail.com", kind: "domain", value: "gmail.com", status: "valid", publicDomain: true },
 * //  { raw: "nope", kind: "domain", value: null, status: "invalid", publicDomain: false }]
 */
export function parseAccessEntries(input: string, kind?: AccessEntryKind): ParsedAccessEntry[] {
  const tokens = input
    .split(/[\n\r,;]+/)
    .flatMap((segment) => {
      const bracketed = [...segment.matchAll(/<([^<>]*)>/g)].map((match) => match[1] ?? "");
      return bracketed.length > 0 ? bracketed : segment.split(/\s+/);
    })
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const seen = new Set<string>();
  return tokens.map((raw): ParsedAccessEntry => {
    const { kind: detected, value } = normalizeToken(raw, kind);
    const publicDomain = detected === "domain" && value !== null && isPublicEmailDomain(value);
    if (value === null) return { raw, kind: detected, value, status: "invalid", publicDomain };
    const key = `${detected}:${value}`;
    if (seen.has(key)) return { raw, kind: detected, value, status: "duplicate", publicDomain };
    seen.add(key);
    return { raw, kind: detected, value, status: "valid", publicDomain };
  });
}

// ---------------------------------------------------------------------------------------------
// Schemas and types
// ---------------------------------------------------------------------------------------------

export const accessEntrySchema = z.object({
  id: z.guid(),
  kind: z.enum(ACCESS_ENTRY_KINDS),
  /** Lower-case email (`an@ahamove.com`) or domain (`ahamove.com`). */
  value: z.string(),
  note: z.string().nullable(),
  createdBy: z.guid().nullable(),
  /** Email of `createdBy`; `null` for system/bootstrap entries. */
  createdByEmail: z.string().nullable(),
  /** ISO 8601 (UTC). */
  createdAt: z.string(),
  /** Active (not deactivated) users whose email this entry matches. */
  userCount: z.number().int(),
  /** Domain entry of a consumer email provider — show the warning badge. */
  publicDomain: z.boolean(),
  /** Email entry of the caller: the UI should disable "remove" (the server refuses it). */
  isSelf: z.boolean(),
});
export type AccessEntry = z.infer<typeof accessEntrySchema>;

export const listAccessEntriesOutputSchema = z.object({ entries: z.array(accessEntrySchema) });
export type ListAccessEntriesOutput = z.infer<typeof listAccessEntriesOutputSchema>;

/** Example output — base for the UI mock (`apps/web/src/server/admin/mock.ts`, T1.7b). */
export const listAccessEntriesExample: ListAccessEntriesOutput = {
  entries: [
    {
      id: "4a110000-0000-4000-8000-000000000001",
      kind: "domain",
      value: "ahamove.com",
      note: "Cả công ty",
      createdBy: "5d2f0000-0000-4000-8000-000000000001",
      createdByEmail: "nguyenthanh.cv@gmail.com",
      createdAt: "2026-09-20T02:00:00+00:00",
      userCount: 42,
      publicDomain: false,
      isSelf: false,
    },
    {
      id: "4a110000-0000-4000-8000-000000000002",
      kind: "email",
      value: "nguyenthanh.cv@gmail.com",
      note: null,
      createdBy: null,
      createdByEmail: null,
      createdAt: "2026-09-01T00:00:00+00:00",
      userCount: 1,
      publicDomain: false,
      isSelf: true,
    },
  ],
};

export const addAccessEntriesInputSchema = z.object({
  /** Pasted text (see {@link parseAccessEntries}) or one token per array item. */
  input: z.union([z.string(), z.array(z.string())]),
  /** Force every token to this kind (e.g. a "domain" tab). Omit to auto-detect. */
  kind: z.enum(ACCESS_ENTRY_KINDS).optional(),
  /** Stored on every added entry, e.g. "Team Vận hành". */
  note: z.string().trim().max(200).nullable().optional(),
  /**
   * Must be `true` to add a public email domain (gmail.com…); otherwise such tokens are skipped
   * with status `publicDomainUnconfirmed`.
   */
  allowPublicDomains: z.boolean().optional(),
});
export type AddAccessEntriesInput = z.input<typeof addAccessEntriesInputSchema>;

export const ADD_ACCESS_STATUSES = [
  "added",
  "duplicate",
  "exists",
  "invalid",
  "publicDomainUnconfirmed",
] as const;
export type AddAccessStatus = (typeof ADD_ACCESS_STATUSES)[number];

export const addAccessEntriesOutputSchema = z.object({
  /** One row per input token, in input order. Label: `admin.access.addStatus.<status>`. */
  results: z.array(
    z.object({
      raw: z.string(),
      kind: z.enum(ACCESS_ENTRY_KINDS),
      value: z.string().nullable(),
      status: z.enum(ADD_ACCESS_STATUSES),
      publicDomain: z.boolean(),
    }),
  ),
  /** The entries actually inserted. */
  added: z.array(accessEntrySchema),
  /** Distinct active users (already registered) that the added entries now cover. */
  matchedUsers: z.number().int(),
});
export type AddAccessEntriesOutput = z.infer<typeof addAccessEntriesOutputSchema>;

export const addAccessEntriesExample: AddAccessEntriesOutput = {
  results: [
    {
      raw: "an@ahamove.com",
      kind: "email",
      value: "an@ahamove.com",
      status: "added",
      publicDomain: false,
    },
    {
      raw: "gmail.com",
      kind: "domain",
      value: "gmail.com",
      status: "publicDomainUnconfirmed",
      publicDomain: true,
    },
    { raw: "nope", kind: "domain", value: null, status: "invalid", publicDomain: false },
  ],
  added: [
    {
      id: "4a110000-0000-4000-8000-000000000003",
      kind: "email",
      value: "an@ahamove.com",
      note: null,
      createdBy: "5d2f0000-0000-4000-8000-000000000001",
      createdByEmail: "nguyenthanh.cv@gmail.com",
      createdAt: "2026-09-27T03:00:00+00:00",
      userCount: 0,
      publicDomain: false,
      isSelf: false,
    },
  ],
  matchedUsers: 0,
};

export const accessEntryIdsInputSchema = z.object({
  ids: z.array(z.guid()).min(1).max(ACCESS_BULK_MAX),
});
export type AccessEntryIdsInput = z.input<typeof accessEntryIdsInputSchema>;

/** Effect on active users of removing entries — same semantics as `app.has_active_access`. */
export const accessImpactSchema = z.object({
  /** Active users matching at least one of the entries. */
  matchedUsers: z.number().int(),
  /** Of those: no other entry, not super admin, no Space membership → signed out next request. */
  losingAccess: z.number().int(),
  /** Of those: no other entry, not super admin, but a Space member → stays, as a guest. */
  becomingGuest: z.number().int(),
});
export type AccessImpact = z.infer<typeof accessImpactSchema>;

export const accessImpactExample: AccessImpact = {
  matchedUsers: 12,
  losingAccess: 3,
  becomingGuest: 1,
};

export const removeAccessEntriesOutputSchema = z.object({
  removed: z.number().int(),
  /** Computed right before the delete. */
  impact: accessImpactSchema,
});
export type RemoveAccessEntriesOutput = z.infer<typeof removeAccessEntriesOutputSchema>;

/**
 * Why a user can sign in (`admin.users.access.<access>`). `invitation` = a guest kept signed in by
 * an invitation they have not accepted yet (T7.8); `none` = signed out on next request.
 */
export const USER_ACCESS_REASONS = [
  "allowlist",
  "deactivated",
  "invitation",
  "membership",
  "none",
  "super_admin",
] as const;
export type UserAccessReason = (typeof USER_ACCESS_REASONS)[number];

export const USER_STATUS_FILTERS = ["all", "active", "deactivated"] as const;
export type UserStatusFilter = (typeof USER_STATUS_FILTERS)[number];

export const adminUserSchema = z.object({
  id: z.guid(),
  email: z.string(),
  fullName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  locale: z.enum(["vi", "en"]),
  isGuest: z.boolean(),
  isSuperAdmin: z.boolean(),
  /** ISO 8601 (UTC); `null` = active. */
  deactivatedAt: z.string().nullable(),
  createdAt: z.string(),
  lastSignInAt: z.string().nullable(),
  /** Number of Spaces the user is an explicit member of. */
  spaceCount: z.number().int(),
  access: z.enum(USER_ACCESS_REASONS),
  /** The caller: the UI disables "deactivate" / "revoke super admin" (the server refuses them). */
  isSelf: z.boolean(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const listUsersInputSchema = z.object({
  /** Case-insensitive substring of email or name. */
  query: z.string().trim().max(200).optional(),
  status: z.enum(USER_STATUS_FILTERS).default("all"),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});
export type ListUsersInput = z.input<typeof listUsersInputSchema>;

export const listUsersOutputSchema = z.object({
  users: z.array(adminUserSchema),
  /** Matching users ignoring limit/offset (0 when `offset` is past the end). */
  total: z.number().int(),
});
export type ListUsersOutput = z.infer<typeof listUsersOutputSchema>;

export const listUsersExample: ListUsersOutput = {
  users: [
    {
      id: "5d2f0000-0000-4000-8000-000000000001",
      email: "nguyenthanh.cv@gmail.com",
      fullName: "Nguyễn Thành",
      avatarUrl: null,
      locale: "vi",
      isGuest: false,
      isSuperAdmin: true,
      deactivatedAt: null,
      createdAt: "2026-09-01T00:00:00+00:00",
      lastSignInAt: "2026-09-27T01:00:00+00:00",
      spaceCount: 3,
      access: "super_admin",
      isSelf: true,
    },
    {
      id: "5d2f0000-0000-4000-8000-000000000002",
      email: "khach@partner.vn",
      fullName: "Khách",
      avatarUrl: null,
      locale: "en",
      isGuest: true,
      isSuperAdmin: false,
      deactivatedAt: null,
      createdAt: "2026-09-10T00:00:00+00:00",
      lastSignInAt: null,
      spaceCount: 1,
      access: "membership",
      isSelf: false,
    },
  ],
  total: 2,
};

export const setUserDeactivatedInputSchema = z.object({
  userId: z.guid(),
  deactivated: z.boolean(),
});
export type SetUserDeactivatedInput = z.input<typeof setUserDeactivatedInputSchema>;

export const setUserSuperAdminInputSchema = z.object({
  userId: z.guid(),
  superAdmin: z.boolean(),
});
export type SetUserSuperAdminInput = z.input<typeof setUserSuperAdminInputSchema>;

export const sendTestEmailInputSchema = z.object({
  /** Recipient; omit to send to the caller's own address. */
  to: z.email().optional(),
});
export type SendTestEmailInput = z.input<typeof sendTestEmailInputSchema>;

export const sendTestEmailOutputSchema = z.object({ to: z.string() });
export type SendTestEmailOutput = z.infer<typeof sendTestEmailOutputSchema>;

/** What {@link sendTestEmail} needs besides the DB (wired to SMTP + i18n in `./actions.ts`). */
export interface TestEmailDeps {
  sendMail: SendMail;
  buildTestEmail: (context: {
    locale: "vi" | "en";
    sender: string;
  }) => Promise<Omit<MailMessage, "to">>;
}

// ---------------------------------------------------------------------------------------------
// Database seam
// ---------------------------------------------------------------------------------------------

interface DbError {
  code?: string;
  message: string;
}
interface DbResult<T> {
  data: T | null;
  error: DbError | null;
}

/** Chainable subset of the PostgREST query builder this module uses. */
export interface AdminQuery extends PromiseLike<DbResult<unknown>> {
  select(columns: string): AdminQuery;
  eq(column: string, value: string): AdminQuery;
  in(column: string, values: readonly string[]): AdminQuery;
  upsert(
    rows: Record<string, unknown>[],
    options: { onConflict: string; ignoreDuplicates: boolean },
  ): AdminQuery;
  delete(): AdminQuery;
  single(): PromiseLike<DbResult<unknown>>;
}

/** The part of a Supabase client this module needs (a `SupabaseClient` satisfies it at runtime). */
export interface AdminDb {
  auth: {
    getUser(): PromiseLike<{ data: { user: { id: string } | null } }>;
  };
  from(table: "access_allowlist" | "profiles"): AdminQuery;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult<unknown>>;
}

const DB_CODES = new Set<string>(ADMIN_ERROR_CODES);

function dbError(error: DbError | null | undefined): AdminError {
  const message = error?.message ?? "";
  if (DB_CODES.has(message)) return new AdminError(message as AdminErrorCode, { cause: error });
  if (error?.code === "42501") return new AdminError("FORBIDDEN", { cause: error });
  if (error?.code === "22023" || error?.code === "22P02" || error?.code === "23514")
    return new AdminError("VALIDATION_FAILED", { cause: error });
  return new AdminError("ADMIN_ACTION_FAILED", { cause: error });
}

function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new AdminError("VALIDATION_FAILED", { cause: parsed.error });
  return parsed.data;
}

interface Caller {
  id: string;
  email: string;
  locale: "vi" | "en";
}

const callerProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  locale: z.enum(["vi", "en"]),
  is_super_admin: z.boolean(),
  deactivated_at: z.string().nullable(),
});

/** Signed-in, active super admin — else `FORBIDDEN` (the DB re-checks on every call anyway). */
async function requireSuperAdmin(db: AdminDb): Promise<Caller> {
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new AdminError("FORBIDDEN");
  const { data, error } = await db
    .from("profiles")
    .select("id, email, locale, is_super_admin, deactivated_at")
    .eq("id", user.id)
    .single();
  if (error || !data) throw new AdminError("FORBIDDEN", { cause: error });
  const profile = callerProfileSchema.parse(data);
  if (!profile.is_super_admin || profile.deactivated_at !== null) throw new AdminError("FORBIDDEN");
  return { id: profile.id, email: profile.email.toLowerCase(), locale: profile.locale };
}

const entryRowSchema = z.object({
  id: z.string(),
  kind: z.enum(ACCESS_ENTRY_KINDS),
  value: z.string(),
  note: z.string().nullable(),
  created_by: z.string().nullable(),
  created_by_email: z.string().nullable(),
  created_at: z.string(),
  user_count: z.number(),
});

function mapEntry(row: z.infer<typeof entryRowSchema>, caller: Caller): AccessEntry {
  const value = row.value.toLowerCase();
  return {
    id: row.id,
    kind: row.kind,
    value,
    note: row.note,
    createdBy: row.created_by,
    createdByEmail: row.created_by_email,
    createdAt: row.created_at,
    userCount: row.user_count,
    publicDomain: row.kind === "domain" && isPublicEmailDomain(value),
    isSelf: row.kind === "email" && value === caller.email,
  };
}

async function fetchEntries(
  db: AdminDb,
  caller: Caller,
  ids: readonly string[] | null,
): Promise<AccessEntry[]> {
  const { data, error } = await db.rpc("admin_list_access_entries", { p_entry_ids: ids });
  if (error) throw dbError(error);
  return z
    .array(entryRowSchema)
    .parse(data ?? [])
    .map((row) => mapEntry(row, caller));
}

const impactRowSchema = z.object({
  matched_users: z.number(),
  losing_access: z.number(),
  becoming_guest: z.number(),
});

async function fetchImpact(db: AdminDb, ids: readonly string[]): Promise<AccessImpact> {
  const { data, error } = await db.rpc("admin_access_impact", { p_entry_ids: ids });
  if (error) throw dbError(error);
  const [row] = z.array(impactRowSchema).parse(data ?? []);
  return {
    matchedUsers: row?.matched_users ?? 0,
    losingAccess: row?.losing_access ?? 0,
    becomingGuest: row?.becoming_guest ?? 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------------------------

/**
 * Every allowlist entry (domains first, then emails, by value), with the number of active users
 * each one matches.
 *
 * @throws {AdminError} `FORBIDDEN`, `ADMIN_ACTION_FAILED`.
 */
export async function listAccessEntries(db: AdminDb): Promise<ListAccessEntriesOutput> {
  const caller = await requireSuperAdmin(db);
  return { entries: await fetchEntries(db, caller, null) };
}

/**
 * Bulk add: parses `input` ({@link parseAccessEntries}), inserts the valid new entries in one
 * statement (existing ones are reported as `exists`, never overwritten) and reports every token.
 * Each insert is audited as `access.add`.
 *
 * @throws {AdminError} `VALIDATION_FAILED` (no token, more than {@link ACCESS_BULK_MAX} tokens,
 *   note too long), `FORBIDDEN`, `ADMIN_ACTION_FAILED`.
 */
export async function addAccessEntries(
  db: AdminDb,
  input: AddAccessEntriesInput,
): Promise<AddAccessEntriesOutput> {
  const parsed = parseInput(addAccessEntriesInputSchema, input);
  const text = Array.isArray(parsed.input) ? parsed.input.join("\n") : parsed.input;
  const tokens = parseAccessEntries(text, parsed.kind);
  if (tokens.length === 0 || tokens.length > ACCESS_BULK_MAX)
    throw new AdminError("VALIDATION_FAILED");
  const caller = await requireSuperAdmin(db);

  const confirmed = parsed.allowPublicDomains === true;
  const toInsert = tokens.filter(
    (token) => token.status === "valid" && (!token.publicDomain || confirmed),
  );

  const insertedIds: string[] = [];
  const insertedKeys = new Set<string>();
  if (toInsert.length > 0) {
    const { data, error } = await db
      .from("access_allowlist")
      .upsert(
        toInsert.map((token) => ({
          kind: token.kind,
          value: token.value,
          note: parsed.note || null,
          created_by: caller.id,
        })),
        { onConflict: "kind,value", ignoreDuplicates: true },
      )
      .select("id, kind, value");
    if (error) throw dbError(error);
    const rows = z
      .array(z.object({ id: z.string(), kind: z.string(), value: z.string() }))
      .parse(data ?? []);
    for (const row of rows) {
      insertedIds.push(row.id);
      insertedKeys.add(`${row.kind}:${row.value.toLowerCase()}`);
    }
  }

  const results = tokens.map((token) => {
    let status: AddAccessStatus;
    if (token.status !== "valid") status = token.status;
    else if (token.publicDomain && !confirmed) status = "publicDomainUnconfirmed";
    else status = insertedKeys.has(`${token.kind}:${token.value}`) ? "added" : "exists";
    return {
      raw: token.raw,
      kind: token.kind,
      value: token.value,
      status,
      publicDomain: token.publicDomain,
    };
  });

  if (insertedIds.length === 0) return { results, added: [], matchedUsers: 0 };
  const [added, impact] = await Promise.all([
    fetchEntries(db, caller, insertedIds),
    fetchImpact(db, insertedIds),
  ]);
  return { results, added, matchedUsers: impact.matchedUsers };
}

/**
 * What removing these entries would do — show it in the confirmation dialog (PLAN R14).
 *
 * @throws {AdminError} `VALIDATION_FAILED`, `FORBIDDEN`, `ADMIN_ACTION_FAILED`.
 */
export async function previewAccessRemoval(
  db: AdminDb,
  input: AccessEntryIdsInput,
): Promise<AccessImpact> {
  const { ids } = parseInput(accessEntryIdsInputSchema, input);
  await requireSuperAdmin(db);
  return fetchImpact(db, [...new Set(ids)]);
}

/**
 * Removes entries — all or nothing on validation: an unknown id or the caller's own email entry
 * aborts before anything is deleted. Each delete is audited as `access.remove`; affected users are
 * signed out on their next request (see {@link previewAccessRemoval} for who).
 *
 * @throws {AdminError} `VALIDATION_FAILED`, `FORBIDDEN`, `ACCESS_ENTRY_NOT_FOUND`,
 *   `ACCESS_CANNOT_REMOVE_SELF`, `ADMIN_ACTION_FAILED`.
 */
export async function removeAccessEntries(
  db: AdminDb,
  input: AccessEntryIdsInput,
): Promise<RemoveAccessEntriesOutput> {
  const ids = [...new Set(parseInput(accessEntryIdsInputSchema, input).ids)];
  const caller = await requireSuperAdmin(db);

  const entries = await fetchEntries(db, caller, ids);
  if (entries.length !== ids.length) throw new AdminError("ACCESS_ENTRY_NOT_FOUND");
  if (entries.some((entry) => entry.isSelf)) throw new AdminError("ACCESS_CANNOT_REMOVE_SELF");

  const impact = await fetchImpact(db, ids);
  const { data, error } = await db.from("access_allowlist").delete().in("id", ids).select("id");
  if (error) throw dbError(error);
  const removed = z.array(z.object({ id: z.string() })).parse(data ?? []).length;
  return { removed, impact };
}

// ---------------------------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------------------------

const userRowSchema = z.object({
  id: z.string(),
  email: z.string(),
  full_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  locale: z.enum(["vi", "en"]),
  is_guest: z.boolean(),
  is_super_admin: z.boolean(),
  deactivated_at: z.string().nullable(),
  created_at: z.string(),
  last_sign_in_at: z.string().nullable(),
  space_count: z.number(),
  access: z.enum(USER_ACCESS_REASONS),
  total_count: z.number(),
});

function mapUser(row: z.infer<typeof userRowSchema>, caller: Caller): AdminUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    locale: row.locale,
    isGuest: row.is_guest,
    isSuperAdmin: row.is_super_admin,
    deactivatedAt: row.deactivated_at,
    createdAt: row.created_at,
    lastSignInAt: row.last_sign_in_at,
    spaceCount: row.space_count,
    access: row.access,
    isSelf: row.id === caller.id,
  };
}

async function fetchUsers(
  db: AdminDb,
  caller: Caller,
  args: Record<string, unknown>,
): Promise<ListUsersOutput> {
  const { data, error } = await db.rpc("admin_list_users", args);
  if (error) throw dbError(error);
  const rows = z.array(userRowSchema).parse(data ?? []);
  return { users: rows.map((row) => mapUser(row, caller)), total: rows[0]?.total_count ?? 0 };
}

/**
 * Users (guests included), by email, with why each one can sign in.
 *
 * @throws {AdminError} `VALIDATION_FAILED`, `FORBIDDEN`, `ADMIN_ACTION_FAILED`.
 */
export async function listUsers(db: AdminDb, input: ListUsersInput = {}): Promise<ListUsersOutput> {
  const parsed = parseInput(listUsersInputSchema, input);
  const caller = await requireSuperAdmin(db);
  return fetchUsers(db, caller, {
    p_query: parsed.query || null,
    p_status: parsed.status,
    p_limit: parsed.limit,
    p_offset: parsed.offset,
  });
}

async function fetchUser(db: AdminDb, caller: Caller, userId: string): Promise<AdminUser> {
  const { users } = await fetchUsers(db, caller, { p_user_id: userId });
  const [user] = users;
  if (!user) throw new AdminError("USER_NOT_FOUND");
  return user;
}

/**
 * Locks (`deactivated: true`) or unlocks a user. A locked user loses every role at once (RLS) and
 * is signed out on their next request; audited as `user.deactivate` / `user.reactivate`.
 * Idempotent.
 *
 * @throws {AdminError} `VALIDATION_FAILED`, `FORBIDDEN`, `USER_NOT_FOUND`,
 *   `USER_CANNOT_CHANGE_SELF` (locking yourself), `LAST_SUPER_ADMIN`, `ADMIN_ACTION_FAILED`.
 */
export async function setUserDeactivated(
  db: AdminDb,
  input: SetUserDeactivatedInput,
): Promise<AdminUser> {
  const { userId, deactivated } = parseInput(setUserDeactivatedInputSchema, input);
  const caller = await requireSuperAdmin(db);
  if (deactivated && userId === caller.id) throw new AdminError("USER_CANNOT_CHANGE_SELF");
  const { error } = await db.rpc("admin_set_user_deactivated", {
    p_user_id: userId,
    p_deactivated: deactivated,
  });
  if (error) throw dbError(error);
  return fetchUser(db, caller, userId);
}

/**
 * Grants or revokes super admin; audited as `user.super_admin_grant` / `user.super_admin_revoke`.
 * Revoking it from someone who is not allowlisted turns them into a guest (signed out unless they
 * are a Space member). Idempotent.
 *
 * @throws {AdminError} `VALIDATION_FAILED`, `FORBIDDEN`, `USER_NOT_FOUND`,
 *   `USER_CANNOT_CHANGE_SELF` (revoking yourself), `LAST_SUPER_ADMIN`, `USER_IS_GUEST` (allowlist
 *   them first), `USER_DEACTIVATED`, `ADMIN_ACTION_FAILED`.
 */
export async function setUserSuperAdmin(
  db: AdminDb,
  input: SetUserSuperAdminInput,
): Promise<AdminUser> {
  const { userId, superAdmin } = parseInput(setUserSuperAdminInputSchema, input);
  const caller = await requireSuperAdmin(db);
  if (!superAdmin && userId === caller.id) throw new AdminError("USER_CANNOT_CHANGE_SELF");
  const { error } = await db.rpc("admin_set_super_admin", {
    p_user_id: userId,
    p_is_super_admin: superAdmin,
  });
  if (error) throw dbError(error);
  return fetchUser(db, caller, userId);
}

// ---------------------------------------------------------------------------------------------
// Test email
// ---------------------------------------------------------------------------------------------

/**
 * Sends the bilingual test email (`email.test.*`, in the caller's `profiles.locale`) to `to`, or to
 * the caller's own address — to check the SMTP settings (docs/PLAN.md §7.14).
 *
 * @throws {AdminError} `VALIDATION_FAILED`, `FORBIDDEN`, `MAIL_NOT_CONFIGURED`, `MAIL_SEND_FAILED`.
 */
export async function sendTestEmail(
  db: AdminDb,
  input: SendTestEmailInput,
  deps: TestEmailDeps,
): Promise<SendTestEmailOutput> {
  const parsed = parseInput(sendTestEmailInputSchema, input);
  const caller = await requireSuperAdmin(db);
  const to = parsed.to ?? caller.email;
  const content = await deps.buildTestEmail({ locale: caller.locale, sender: caller.email });
  try {
    await deps.sendMail({ to, ...content });
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "MAIL_NOT_CONFIGURED" || code === "MAIL_SEND_FAILED")
      throw new AdminError(code, { cause: error });
    throw new AdminError("MAIL_SEND_FAILED", { cause: error });
  }
  return { to };
}
