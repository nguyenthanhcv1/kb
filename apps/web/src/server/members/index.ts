import { createHash, randomBytes } from "node:crypto";

import { isLocale, type Locale } from "@kb/i18n";
import { z } from "zod";

import { renderInvitationEmail } from "@/server/email/invitation-email";
import type { Mailer } from "@/server/email/mailer";

/**
 * Space members + guest invitations contract (task T1.5a, docs/PLAN.md §9 T1.5, §3.2
 * `space_members` / `invitations`).
 *
 * Every function takes a caller-scoped Supabase client (`createClient()` from
 * `@/lib/supabase/server`, never the service-role client): RLS (`app.is_space_admin`,
 * `app.can_view_space`) decides who may do what, DB triggers enforce "guests are never admins",
 * "a Space keeps at least one admin" and "an invitation is single-use", and audit triggers record
 * `member.*` / `invitation.*`. The invitee (not a Space admin, so blind to `invitations` under RLS)
 * previews and accepts through the SECURITY DEFINER SQL functions `public.get_invitation` /
 * `public.accept_invitation` (migration `*_members_invitations.sql`), keyed by the token hash.
 *
 * Tokens: 32 random bytes, base64url (43 chars). Only `sha256(token)` (hex) is stored in
 * `invitations.token_hash`; the raw token exists only in the email / invite link
 * `${APP_URL}/invite/<token>`. Invitations expire after 14 days ({@link INVITATION_TTL_DAYS}).
 *
 * Usage (Server Component / Server Action — or the wrappers in `./actions.ts`):
 *
 * ```ts
 * const { members } = await listMembers(supabase, { spaceId });
 * // [{ userId: "5d2f…0002", role: "admin", email: "an@thanhgo.com", fullName: "Nguyễn An",
 * //    avatarUrl: null, isGuest: false, addedBy: null, joinedAt: "2026-09-01T02:00:00+00:00", … }]
 * const { candidates } = await searchMemberCandidates(supabase, { spaceId, query: "binh" });
 * await addMember(supabase, { spaceId, userId: candidates[0].userId, role: "editor" });
 * await changeMemberRole(supabase, { spaceId, userId, role: "viewer" });
 * await removeMember(supabase, { spaceId, userId });
 * await leaveSpace(supabase, { spaceId });
 *
 * const created = await createInvitation(supabase, { spaceId, email: "khach@partner.vn", role: "viewer" },
 *   { appUrl: "https://kb.thanhgo.com", mailer });
 * // { invitation: { id, status: "pending", expiresAt: "…+14 days", … },
 * //   inviteUrl: "https://kb.thanhgo.com/invite/q3V…", emailStatus: "sent" }
 * await revokeInvitation(supabase, { invitationId: created.invitation.id });
 *
 * // `/invite/[token]` page (T1.5b):
 * const preview = await getInvitation(supabase, { token });
 * const { spaceSlug } = await acceptInvitation(supabase, { token }); // → redirect(`/s/${spaceSlug}`)
 * ```
 *
 * Errors: {@link MemberError} with a code from {@link MEMBER_ERROR_CODES}; the UI shows
 * `errors.<code>`.
 */

export const MEMBER_ERROR_CODES = [
  "FORBIDDEN",
  "GUEST_CANNOT_BE_SPACE_ADMIN",
  "INVITATION_ALREADY_PENDING",
  "INVITATION_ALREADY_USED",
  "INVITATION_EMAIL_MISMATCH",
  "INVITATION_EXPIRED",
  "INVITATION_NOT_FOUND",
  "INVITATION_REVOKED",
  "MEMBER_ACTION_FAILED",
  "MEMBER_ALREADY_EXISTS",
  "MEMBER_NOT_FOUND",
  "MEMBER_USER_NOT_FOUND",
  "SPACE_NOT_FOUND",
  "SPACE_REQUIRES_ADMIN",
  "UNAUTHORIZED",
  "VALIDATION_FAILED",
] as const;
export type MemberErrorCode = (typeof MEMBER_ERROR_CODES)[number];

export class MemberError extends Error {
  constructor(
    readonly code: MemberErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = "MemberError";
  }
}

export const MEMBER_ROLES = ["viewer", "editor", "admin"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/** Guests are never Space admins (`invitations.role <> 'admin'`). */
export const INVITATION_ROLES = ["viewer", "editor"] as const;
export type InvitationRole = (typeof INVITATION_ROLES)[number];

export const INVITATION_STATUSES = ["pending", "accepted", "revoked", "expired"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** Matches the column default `now() + interval '14 days'`; resend extends by the same amount. */
export const INVITATION_TTL_DAYS = 14;

// ---------------------------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------------------------

const roleSchema = z.enum(MEMBER_ROLES);
const invitationRoleSchema = z.enum(INVITATION_ROLES);
/** base64url, as produced by {@link generateInvitationToken}; loose bounds so old/other formats still hash. */
const tokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,256}$/)
  .describe("raw invitation token from the /invite/[token] URL");

export const spaceIdInputSchema = z.object({ spaceId: z.guid() });
export type SpaceIdInput = z.input<typeof spaceIdInputSchema>;

export const searchMemberCandidatesInputSchema = z.object({
  spaceId: z.guid(),
  /** Name or email fragment; accent/case-insensitive ("binh" finds "Bình"). */
  query: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(50).optional(),
});
export type SearchMemberCandidatesInput = z.input<typeof searchMemberCandidatesInputSchema>;

export const addMemberInputSchema = z.object({
  spaceId: z.guid(),
  userId: z.guid(),
  role: roleSchema,
});
export type AddMemberInput = z.input<typeof addMemberInputSchema>;

export const changeMemberRoleInputSchema = addMemberInputSchema;
export type ChangeMemberRoleInput = z.input<typeof changeMemberRoleInputSchema>;

export const removeMemberInputSchema = z.object({ spaceId: z.guid(), userId: z.guid() });
export type RemoveMemberInput = z.input<typeof removeMemberInputSchema>;

export const listInvitationsInputSchema = z.object({
  spaceId: z.guid(),
  /** Also return accepted and revoked invitations (default: only pending + expired). */
  includeInactive: z.boolean().optional(),
});
export type ListInvitationsInput = z.input<typeof listInvitationsInputSchema>;

export const createInvitationInputSchema = z.object({
  spaceId: z.guid(),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  role: invitationRoleSchema,
});
export type CreateInvitationInput = z.input<typeof createInvitationInputSchema>;

export const invitationIdInputSchema = z.object({ invitationId: z.guid() });
export type InvitationIdInput = z.input<typeof invitationIdInputSchema>;

export const invitationTokenInputSchema = z.object({ token: tokenSchema });
export type InvitationTokenInput = z.input<typeof invitationTokenInputSchema>;

export const spaceMemberSchema = z.object({
  userId: z.guid(),
  role: roleSchema,
  /** Profile fields are `null` when RLS hides the profile (guest seen by a non-member). */
  email: z.string().nullable(),
  fullName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  isGuest: z.boolean().nullable(),
  addedBy: z.guid().nullable(),
  /** ISO 8601 (UTC). */
  joinedAt: z.string(),
  updatedAt: z.string(),
});
export type SpaceMember = z.infer<typeof spaceMemberSchema>;

export const listMembersOutputSchema = z.object({ members: z.array(spaceMemberSchema) });
export type ListMembersOutput = z.infer<typeof listMembersOutputSchema>;

export const memberCandidateSchema = z.object({
  userId: z.guid(),
  email: z.string(),
  fullName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type MemberCandidate = z.infer<typeof memberCandidateSchema>;

export const searchMemberCandidatesOutputSchema = z.object({
  candidates: z.array(memberCandidateSchema),
});
export type SearchMemberCandidatesOutput = z.infer<typeof searchMemberCandidatesOutputSchema>;

export const invitationSchema = z.object({
  id: z.guid(),
  spaceId: z.guid(),
  email: z.string(),
  role: invitationRoleSchema,
  status: z.enum(INVITATION_STATUSES),
  invitedBy: z.guid(),
  expiresAt: z.string(),
  createdAt: z.string(),
  acceptedAt: z.string().nullable(),
  acceptedBy: z.guid().nullable(),
  revokedAt: z.string().nullable(),
});
export type Invitation = z.infer<typeof invitationSchema>;

export const listInvitationsOutputSchema = z.object({ invitations: z.array(invitationSchema) });
export type ListInvitationsOutput = z.infer<typeof listInvitationsOutputSchema>;

export const EMAIL_STATUSES = ["sent", "skipped", "failed"] as const;
/** `skipped`: SMTP not configured; `failed`: SMTP error (logged). The invitation exists either way. */
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const sentInvitationSchema = z.object({
  invitation: invitationSchema,
  /** `${APP_URL}/invite/<token>` — shown once to the admin (copy link), never stored. */
  inviteUrl: z.string(),
  emailStatus: z.enum(EMAIL_STATUSES),
});
export type SentInvitation = z.infer<typeof sentInvitationSchema>;

export const invitationPreviewSchema = z.object({
  invitationId: z.guid(),
  spaceId: z.guid(),
  spaceSlug: z.string(),
  spaceName: z.string(),
  spaceIcon: z.string().nullable(),
  role: invitationRoleSchema,
  email: z.string(),
  inviterName: z.string().nullable(),
  inviterEmail: z.string().nullable(),
  expiresAt: z.string(),
  status: z.enum(INVITATION_STATUSES),
  /** The signed-in account's email is the invited one (else show "sign in with <email>"). */
  emailMatches: z.boolean(),
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

export const acceptInvitationOutputSchema = z.object({
  spaceId: z.guid(),
  spaceSlug: z.string(),
  /** Effective role after accepting (an existing higher role is kept). */
  role: roleSchema,
});
export type AcceptInvitationOutput = z.infer<typeof acceptInvitationOutputSchema>;

// ---------------------------------------------------------------------------------------------
// Example data — base for the UI mock (`apps/web/src/server/members/mock.ts`, T1.5b)
// ---------------------------------------------------------------------------------------------

export const listMembersExample: ListMembersOutput = {
  members: [
    {
      userId: "5d2f0000-0000-4000-8000-000000000002",
      role: "admin",
      email: "an.nguyen@thanhgo.com",
      fullName: "Nguyễn An",
      avatarUrl: null,
      isGuest: false,
      addedBy: null,
      joinedAt: "2026-09-01T02:00:00+00:00",
      updatedAt: "2026-09-01T02:00:00+00:00",
    },
    {
      userId: "5d2f0000-0000-4000-8000-000000000003",
      role: "viewer",
      email: "khach@partner.vn",
      fullName: "Trần Khách",
      avatarUrl: null,
      isGuest: true,
      addedBy: "5d2f0000-0000-4000-8000-000000000002",
      joinedAt: "2026-09-10T03:00:00+00:00",
      updatedAt: "2026-09-10T03:00:00+00:00",
    },
  ],
};

export const searchMemberCandidatesExample: SearchMemberCandidatesOutput = {
  candidates: [
    {
      userId: "5d2f0000-0000-4000-8000-000000000004",
      email: "binh.le@thanhgo.com",
      fullName: "Lê Bình",
      avatarUrl: null,
    },
  ],
};

export const listInvitationsExample: ListInvitationsOutput = {
  invitations: [
    {
      id: "7a1c0000-0000-4000-8000-000000000001",
      spaceId: "0b9a0000-0000-4000-8000-000000000001",
      email: "doitac@partner.vn",
      role: "editor",
      status: "pending",
      invitedBy: "5d2f0000-0000-4000-8000-000000000002",
      expiresAt: "2026-10-11T02:00:00+00:00",
      createdAt: "2026-09-27T02:00:00+00:00",
      acceptedAt: null,
      acceptedBy: null,
      revokedAt: null,
    },
  ],
};

export const invitationPreviewExample: InvitationPreview = {
  invitationId: "7a1c0000-0000-4000-8000-000000000001",
  spaceId: "0b9a0000-0000-4000-8000-000000000001",
  spaceSlug: "design",
  spaceName: "Design",
  spaceIcon: "🎨",
  role: "editor",
  email: "doitac@partner.vn",
  inviterName: "Nguyễn An",
  inviterEmail: "an.nguyen@thanhgo.com",
  expiresAt: "2026-10-11T02:00:00+00:00",
  status: "pending",
  emailMatches: true,
};

// ---------------------------------------------------------------------------------------------
// Db port
// ---------------------------------------------------------------------------------------------

export interface DbError {
  code?: string;
  message: string;
}
export interface DbResult<T> {
  data: T | null;
  error: DbError | null;
}

/**
 * Chainable subset of supabase-js's query builders this module relies on (a real
 * `SupabaseClient` is narrowed to it with a cast at the boundary — see `./actions.ts`).
 */
export interface MembersQuery extends PromiseLike<DbResult<unknown>> {
  select(columns: string): MembersQuery;
  insert(row: Record<string, unknown>): MembersQuery;
  update(row: Record<string, unknown>): MembersQuery;
  delete(): MembersQuery;
  eq(column: string, value: string): MembersQuery;
  is(column: string, value: null): MembersQuery;
  gt(column: string, value: string): MembersQuery;
  order(column: string, options?: { ascending?: boolean }): MembersQuery;
  maybeSingle(): PromiseLike<DbResult<unknown>>;
  single(): PromiseLike<DbResult<unknown>>;
}

export type MembersTable = "profiles" | "spaces" | "space_members" | "invitations";
export type MembersRpc =
  "list_space_members" | "search_member_candidates" | "get_invitation" | "accept_invitation";

export interface MembersDb {
  auth: {
    getUser(): PromiseLike<{ data: { user: { id: string } | null } }>;
  };
  from(table: MembersTable): MembersQuery;
  rpc(fn: MembersRpc, args: Record<string, unknown>): PromiseLike<DbResult<unknown>>;
}

/** Side effects of sending an invitation (injected so tests need no SMTP). */
export interface InvitationDeps {
  /** Public origin of kb-web (`APP_URL`), e.g. `https://kb.thanhgo.com`. */
  appUrl: string;
  /** `null` = SMTP not configured → `emailStatus: "skipped"`. */
  mailer: Mailer | null;
  now?: () => Date;
}

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

/** New raw invitation token: 32 random bytes, base64url (43 chars, URL-safe). */
export function generateInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

/** `invitations.token_hash` of a raw token — must equal SQL `app.invitation_token_hash`. */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Invite link for a raw token: `${appUrl}/invite/<token>`. */
export function invitationUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, "")}/invite/${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------------------------

const PG_UNIQUE_VIOLATION = "23505";
const PG_FOREIGN_KEY_VIOLATION = "23503";
const PG_INSUFFICIENT_PRIVILEGE = "42501";
const PG_CHECK_VIOLATION = "23514";
const PG_INVALID_TEXT = "22P02";

/** Error messages raised by DB triggers / SQL functions that are already stable codes. */
const DB_CODES = new Set<MemberErrorCode>([
  "FORBIDDEN",
  "GUEST_CANNOT_BE_SPACE_ADMIN",
  "INVITATION_ALREADY_USED",
  "INVITATION_EMAIL_MISMATCH",
  "INVITATION_EXPIRED",
  "INVITATION_NOT_FOUND",
  "INVITATION_REVOKED",
  "SPACE_REQUIRES_ADMIN",
  "UNAUTHORIZED",
]);

/** DB error → code: raised codes pass through, RLS/privilege → FORBIDDEN, else MEMBER_ACTION_FAILED. */
export function toMemberError(
  error: unknown,
  overrides: Partial<Record<string, MemberErrorCode>> = {},
): MemberError {
  if (error instanceof MemberError) return error;
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  if (message && DB_CODES.has(message as MemberErrorCode)) {
    return new MemberError(message as MemberErrorCode, { cause: error });
  }
  const override = code ? overrides[code] : undefined;
  if (override) return new MemberError(override, { cause: error });
  if (code === PG_INSUFFICIENT_PRIVILEGE) return new MemberError("FORBIDDEN", { cause: error });
  if (code === PG_INVALID_TEXT || code === PG_CHECK_VIOLATION)
    return new MemberError("VALIDATION_FAILED", { cause: error });
  return new MemberError("MEMBER_ACTION_FAILED", { cause: error });
}

function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new MemberError("VALIDATION_FAILED", { cause: result.error });
  return result.data;
}

function parseData<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw new MemberError("MEMBER_ACTION_FAILED", { cause: result.error });
  return result.data;
}

async function requireUserId(db: MembersDb): Promise<string> {
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new MemberError("UNAUTHORIZED");
  return user.id;
}

async function unwrap<T>(query: PromiseLike<DbResult<T>>): Promise<T | null> {
  const { data, error } = await query;
  if (error) throw toMemberError(error);
  return data;
}

async function spaceIsVisible(db: MembersDb, spaceId: string): Promise<boolean> {
  const data = await unwrap(db.from("spaces").select("id").eq("id", spaceId).maybeSingle());
  return data !== null;
}

/**
 * Why a write on a member row matched nothing: the Space is invisible (SPACE_NOT_FOUND — the same
 * answer for "does not exist" and "no access", so existence never leaks), the member row does not
 * exist (MEMBER_NOT_FOUND), or RLS hid it from the write only (FORBIDDEN: not a Space admin).
 */
async function diagnoseMemberWrite(
  db: MembersDb,
  spaceId: string,
  userId: string,
): Promise<MemberError> {
  if (!(await spaceIsVisible(db, spaceId))) return new MemberError("SPACE_NOT_FOUND");
  const member = await unwrap(
    db
      .from("space_members")
      .select("user_id")
      .eq("space_id", spaceId)
      .eq("user_id", userId)
      .maybeSingle(),
  );
  return new MemberError(member ? "FORBIDDEN" : "MEMBER_NOT_FOUND");
}

const memberRowSchema = z.object({
  user_id: z.guid(),
  role: roleSchema,
  email: z.string().nullable(),
  full_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  is_guest: z.boolean().nullable(),
  added_by: z.guid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

function mapMember(row: z.infer<typeof memberRowSchema>): SpaceMember {
  return {
    userId: row.user_id,
    role: row.role,
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    isGuest: row.is_guest,
    addedBy: row.added_by,
    joinedAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function fetchMembers(db: MembersDb, spaceId: string): Promise<SpaceMember[]> {
  const data = await unwrap(db.rpc("list_space_members", { p_space_id: spaceId }));
  return parseData(z.array(memberRowSchema), data ?? []).map(mapMember);
}

async function fetchMember(db: MembersDb, spaceId: string, userId: string): Promise<SpaceMember> {
  const member = (await fetchMembers(db, spaceId)).find((m) => m.userId === userId);
  if (!member) throw new MemberError("MEMBER_NOT_FOUND");
  return member;
}

const INVITATION_COLUMNS =
  "id, space_id, email, role, invited_by, expires_at, accepted_at, accepted_by, revoked_at, created_at";

const invitationRowSchema = z.object({
  id: z.guid(),
  space_id: z.guid(),
  email: z.string(),
  role: invitationRoleSchema,
  invited_by: z.guid(),
  expires_at: z.string(),
  accepted_at: z.string().nullable(),
  accepted_by: z.guid().nullable(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
});
type InvitationRow = z.infer<typeof invitationRowSchema>;

function invitationStatus(row: InvitationRow, now: Date): InvitationStatus {
  if (row.accepted_at) return "accepted";
  if (row.revoked_at) return "revoked";
  if (new Date(row.expires_at).getTime() <= now.getTime()) return "expired";
  return "pending";
}

function mapInvitation(row: InvitationRow, now: Date): Invitation {
  return {
    id: row.id,
    spaceId: row.space_id,
    email: row.email,
    role: row.role,
    status: invitationStatus(row, now),
    invitedBy: row.invited_by,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    acceptedBy: row.accepted_by,
    revokedAt: row.revoked_at,
  };
}

async function fetchInvitation(db: MembersDb, invitationId: string): Promise<InvitationRow> {
  const data = await unwrap(
    db.from("invitations").select(INVITATION_COLUMNS).eq("id", invitationId).maybeSingle(),
  );
  // RLS: only Space admins see invitations — "not found" and "not an admin" look the same.
  if (!data) throw new MemberError("INVITATION_NOT_FOUND");
  return parseData(invitationRowSchema, data);
}

function assertPending(row: InvitationRow): void {
  if (row.accepted_at) throw new MemberError("INVITATION_ALREADY_USED");
  if (row.revoked_at) throw new MemberError("INVITATION_REVOKED");
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Sends the invitation email; never throws — failures are logged and reported as `failed`. */
async function deliverInvitation(
  db: MembersDb,
  row: InvitationRow,
  inviteUrl: string,
  callerId: string,
  deps: InvitationDeps,
): Promise<EmailStatus> {
  if (!deps.mailer) return "skipped";
  try {
    const [space, inviter, invitee] = await Promise.all([
      unwrap(db.from("spaces").select("name").eq("id", row.space_id).maybeSingle()),
      unwrap(db.from("profiles").select("full_name, email").eq("id", callerId).maybeSingle()),
      // Visible only when RLS lets the inviter see the invitee (internal user / co-member).
      unwrap(db.from("profiles").select("locale").eq("email", row.email).maybeSingle()),
    ]);
    const spaceName = parseData(z.object({ name: z.string() }), space).name;
    const inviterRow = parseData(
      z.object({ full_name: z.string().nullable(), email: z.string() }).nullable(),
      inviter,
    );
    const inviteeLocale = (invitee as { locale?: unknown } | null)?.locale;
    // Known locale → only that language; no account yet (or hidden) → vi then en (PLAN §5 Email).
    const locales: Locale[] = isLocale(inviteeLocale) ? [inviteeLocale] : ["vi", "en"];

    const message = await renderInvitationEmail({
      to: row.email,
      locales,
      inviterName: inviterRow?.full_name || inviterRow?.email || "",
      spaceName,
      role: row.role,
      acceptUrl: inviteUrl,
      expiresAt: row.expires_at,
    });
    await deps.mailer.send({ ...message, replyTo: inviterRow?.email });
    return "sent";
  } catch (error) {
    console.error("[members] invitation email failed", { invitationId: row.id, error });
    return "failed";
  }
}

// ---------------------------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------------------------

/**
 * Members of a Space, admins first then by name. Anyone who can view the Space may list them.
 *
 * @throws {MemberError} `VALIDATION_FAILED`, `UNAUTHORIZED`, `SPACE_NOT_FOUND`, `MEMBER_ACTION_FAILED`.
 */
export async function listMembers(db: MembersDb, input: SpaceIdInput): Promise<ListMembersOutput> {
  const { spaceId } = parseInput(spaceIdInputSchema, input);
  await requireUserId(db);
  if (!(await spaceIsVisible(db, spaceId))) throw new MemberError("SPACE_NOT_FOUND");
  return { members: await fetchMembers(db, spaceId) };
}

/**
 * Internal (non-guest, active) people not yet in the Space whose name/email contains `query`,
 * accent-insensitive. Returns an empty list to non-admins (SQL `search_member_candidates`).
 *
 * @throws {MemberError} `VALIDATION_FAILED`, `UNAUTHORIZED`, `MEMBER_ACTION_FAILED`.
 */
export async function searchMemberCandidates(
  db: MembersDb,
  input: SearchMemberCandidatesInput,
): Promise<SearchMemberCandidatesOutput> {
  const parsed = parseInput(searchMemberCandidatesInputSchema, input);
  await requireUserId(db);
  const data = await unwrap(
    db.rpc("search_member_candidates", {
      p_space_id: parsed.spaceId,
      p_query: parsed.query,
      p_limit: parsed.limit ?? 10,
    }),
  );
  const rows = parseData(
    z.array(
      z.object({
        user_id: z.guid(),
        email: z.string(),
        full_name: z.string().nullable(),
        avatar_url: z.string().nullable(),
      }),
    ),
    data ?? [],
  );
  return {
    candidates: rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      fullName: row.full_name,
      avatarUrl: row.avatar_url,
    })),
  };
}

/**
 * Adds an internal user to the Space (Space admins only). Guests cannot be added this way — they
 * join through an email invitation — so a guest, deactivated or invisible user is
 * `MEMBER_USER_NOT_FOUND`.
 *
 * @throws {MemberError} `VALIDATION_FAILED`, `UNAUTHORIZED`, `MEMBER_USER_NOT_FOUND`,
 *   `MEMBER_ALREADY_EXISTS`, `SPACE_NOT_FOUND`, `FORBIDDEN`, `MEMBER_ACTION_FAILED`.
 */
export async function addMember(db: MembersDb, input: AddMemberInput): Promise<SpaceMember> {
  const parsed = parseInput(addMemberInputSchema, input);
  const callerId = await requireUserId(db);

  const profile = await unwrap(
    db
      .from("profiles")
      .select("id, is_guest, deactivated_at")
      .eq("id", parsed.userId)
      .maybeSingle(),
  );
  const target = profile as { is_guest?: boolean; deactivated_at?: string | null } | null;
  if (!target || target.is_guest !== false || target.deactivated_at) {
    throw new MemberError("MEMBER_USER_NOT_FOUND");
  }

  const { error } = await db
    .from("space_members")
    .insert({
      space_id: parsed.spaceId,
      user_id: parsed.userId,
      role: parsed.role,
      added_by: callerId,
    })
    .select("user_id")
    .single();
  if (error) {
    if (error.code === PG_INSUFFICIENT_PRIVILEGE) {
      throw (await spaceIsVisible(db, parsed.spaceId))
        ? new MemberError("FORBIDDEN", { cause: error })
        : new MemberError("SPACE_NOT_FOUND", { cause: error });
    }
    throw toMemberError(error, {
      [PG_UNIQUE_VIOLATION]: "MEMBER_ALREADY_EXISTS",
      [PG_FOREIGN_KEY_VIOLATION]: "SPACE_NOT_FOUND",
    });
  }
  return fetchMember(db, parsed.spaceId, parsed.userId);
}

/**
 * Changes a member's role (Space admins only). The DB refuses to demote the last admin
 * (`SPACE_REQUIRES_ADMIN`) and to make a guest an admin (`GUEST_CANNOT_BE_SPACE_ADMIN`).
 *
 * @throws {MemberError} `VALIDATION_FAILED`, `UNAUTHORIZED`, `SPACE_NOT_FOUND`, `MEMBER_NOT_FOUND`,
 *   `FORBIDDEN`, `SPACE_REQUIRES_ADMIN`, `GUEST_CANNOT_BE_SPACE_ADMIN`, `MEMBER_ACTION_FAILED`.
 */
export async function changeMemberRole(
  db: MembersDb,
  input: ChangeMemberRoleInput,
): Promise<SpaceMember> {
  const parsed = parseInput(changeMemberRoleInputSchema, input);
  await requireUserId(db);

  const data = await unwrap(
    db
      .from("space_members")
      .update({ role: parsed.role })
      .eq("space_id", parsed.spaceId)
      .eq("user_id", parsed.userId)
      .select("user_id")
      .maybeSingle(),
  );
  if (!data) throw await diagnoseMemberWrite(db, parsed.spaceId, parsed.userId);
  return fetchMember(db, parsed.spaceId, parsed.userId);
}

/**
 * Removes a member (Space admins; removing yourself is {@link leaveSpace}). The last admin cannot
 * be removed (`SPACE_REQUIRES_ADMIN`).
 *
 * @throws {MemberError} `VALIDATION_FAILED`, `UNAUTHORIZED`, `SPACE_NOT_FOUND`, `MEMBER_NOT_FOUND`,
 *   `FORBIDDEN`, `SPACE_REQUIRES_ADMIN`, `MEMBER_ACTION_FAILED`.
 */
export async function removeMember(db: MembersDb, input: RemoveMemberInput): Promise<void> {
  const parsed = parseInput(removeMemberInputSchema, input);
  await requireUserId(db);

  const data = await unwrap(
    db
      .from("space_members")
      .delete()
      .eq("space_id", parsed.spaceId)
      .eq("user_id", parsed.userId)
      .select("user_id"),
  );
  if (!Array.isArray(data) || data.length === 0) {
    throw await diagnoseMemberWrite(db, parsed.spaceId, parsed.userId);
  }
}

/**
 * The caller leaves the Space (any explicit member may; RLS `space_members_delete` allows
 * `user_id = auth.uid()`). The last admin must hand over first (`SPACE_REQUIRES_ADMIN`). Implicit
 * viewers of an `internal` Space and super admins who are not members get `MEMBER_NOT_FOUND`.
 *
 * @throws {MemberError} `VALIDATION_FAILED`, `UNAUTHORIZED`, `SPACE_NOT_FOUND`, `MEMBER_NOT_FOUND`,
 *   `SPACE_REQUIRES_ADMIN`, `MEMBER_ACTION_FAILED`.
 */
export async function leaveSpace(db: MembersDb, input: SpaceIdInput): Promise<void> {
  const { spaceId } = parseInput(spaceIdInputSchema, input);
  const callerId = await requireUserId(db);

  const data = await unwrap(
    db
      .from("space_members")
      .delete()
      .eq("space_id", spaceId)
      .eq("user_id", callerId)
      .select("user_id"),
  );
  if (!Array.isArray(data) || data.length === 0) {
    throw (await spaceIsVisible(db, spaceId))
      ? new MemberError("MEMBER_NOT_FOUND")
      : new MemberError("SPACE_NOT_FOUND");
  }
}

// ---------------------------------------------------------------------------------------------
// Invitations (Space admin side)
// ---------------------------------------------------------------------------------------------

/**
 * Invitations of a Space, newest first. Only Space admins see any (RLS); for other callers who can
 * view the Space the list is simply empty.
 *
 * @throws {MemberError} `VALIDATION_FAILED`, `UNAUTHORIZED`, `SPACE_NOT_FOUND`, `MEMBER_ACTION_FAILED`.
 */
export async function listInvitations(
  db: MembersDb,
  input: ListInvitationsInput,
  now: () => Date = () => new Date(),
): Promise<ListInvitationsOutput> {
  const parsed = parseInput(listInvitationsInputSchema, input);
  await requireUserId(db);

  let query = db
    .from("invitations")
    .select(INVITATION_COLUMNS)
    .eq("space_id", parsed.spaceId)
    .order("created_at", { ascending: false });
  if (!parsed.includeInactive) query = query.is("accepted_at", null).is("revoked_at", null);
  const data = await unwrap(query);
  const rows = parseData(z.array(invitationRowSchema), data ?? []);
  if (rows.length === 0 && !(await spaceIsVisible(db, parsed.spaceId))) {
    throw new MemberError("SPACE_NOT_FOUND");
  }
  const at = now();
  return { invitations: rows.map((row) => mapInvitation(row, at)) };
}

/**
 * Invites someone by email (Space admins only; role `viewer` or `editor`), valid 14 days, and
 * emails them the link. The email is best-effort: the invitation is created even if SMTP is not
 * configured (`emailStatus: "skipped"`) or fails (`"failed"`), and `inviteUrl` lets the admin share
 * the link by hand.
 *
 * @throws {MemberError} `VALIDATION_FAILED`, `UNAUTHORIZED`, `MEMBER_ALREADY_EXISTS` (the email
 *   is already a member), `INVITATION_ALREADY_PENDING` (use {@link resendInvitation}),
 *   `SPACE_NOT_FOUND`, `FORBIDDEN`, `MEMBER_ACTION_FAILED`.
 */
export async function createInvitation(
  db: MembersDb,
  input: CreateInvitationInput,
  deps: InvitationDeps,
): Promise<SentInvitation> {
  const parsed = parseInput(createInvitationInputSchema, input);
  const callerId = await requireUserId(db);
  const now = deps.now?.() ?? new Date();

  const members = await fetchMembers(db, parsed.spaceId);
  if (members.some((member) => member.email?.toLowerCase() === parsed.email)) {
    throw new MemberError("MEMBER_ALREADY_EXISTS");
  }

  const pending = await unwrap(
    db
      .from("invitations")
      .select("id")
      .eq("space_id", parsed.spaceId)
      .eq("email", parsed.email)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", now.toISOString()),
  );
  if (Array.isArray(pending) && pending.length > 0) {
    throw new MemberError("INVITATION_ALREADY_PENDING");
  }

  const token = generateInvitationToken();
  const { data, error } = await db
    .from("invitations")
    .insert({
      space_id: parsed.spaceId,
      email: parsed.email,
      role: parsed.role,
      token_hash: hashInvitationToken(token),
      invited_by: callerId,
      expires_at: addDays(now, INVITATION_TTL_DAYS).toISOString(),
    })
    .select(INVITATION_COLUMNS)
    .single();
  if (error) {
    if (error.code === PG_INSUFFICIENT_PRIVILEGE) {
      throw (await spaceIsVisible(db, parsed.spaceId))
        ? new MemberError("FORBIDDEN", { cause: error })
        : new MemberError("SPACE_NOT_FOUND", { cause: error });
    }
    throw toMemberError(error, { [PG_FOREIGN_KEY_VIOLATION]: "SPACE_NOT_FOUND" });
  }

  const row = parseData(invitationRowSchema, data);
  const inviteUrl = invitationUrl(deps.appUrl, token);
  const emailStatus = await deliverInvitation(db, row, inviteUrl, callerId, deps);
  return { invitation: mapInvitation(row, now), inviteUrl, emailStatus };
}

/**
 * Re-sends a pending (or expired) invitation: rotates the token — the old link stops working —
 * and restarts the 14-day expiry.
 *
 * @throws {MemberError} `VALIDATION_FAILED`, `UNAUTHORIZED`, `INVITATION_NOT_FOUND` (also: not a
 *   Space admin), `INVITATION_ALREADY_USED`, `INVITATION_REVOKED`, `MEMBER_ACTION_FAILED`.
 */
export async function resendInvitation(
  db: MembersDb,
  input: InvitationIdInput,
  deps: InvitationDeps,
): Promise<SentInvitation> {
  const { invitationId } = parseInput(invitationIdInputSchema, input);
  const callerId = await requireUserId(db);
  const now = deps.now?.() ?? new Date();
  assertPending(await fetchInvitation(db, invitationId));

  const token = generateInvitationToken();
  const data = await unwrap(
    db
      .from("invitations")
      .update({
        token_hash: hashInvitationToken(token),
        expires_at: addDays(now, INVITATION_TTL_DAYS).toISOString(),
      })
      .eq("id", invitationId)
      .select(INVITATION_COLUMNS)
      .maybeSingle(),
  );
  if (!data) throw new MemberError("INVITATION_NOT_FOUND");

  const row = parseData(invitationRowSchema, data);
  const inviteUrl = invitationUrl(deps.appUrl, token);
  const emailStatus = await deliverInvitation(db, row, inviteUrl, callerId, deps);
  return { invitation: mapInvitation(row, now), inviteUrl, emailStatus };
}

/**
 * Revokes a pending invitation; its link then fails with `INVITATION_REVOKED`.
 *
 * @throws {MemberError} `VALIDATION_FAILED`, `UNAUTHORIZED`, `INVITATION_NOT_FOUND` (also: not a
 *   Space admin), `INVITATION_ALREADY_USED`, `INVITATION_REVOKED`, `MEMBER_ACTION_FAILED`.
 */
export async function revokeInvitation(
  db: MembersDb,
  input: InvitationIdInput,
  now: () => Date = () => new Date(),
): Promise<Invitation> {
  const { invitationId } = parseInput(invitationIdInputSchema, input);
  await requireUserId(db);
  assertPending(await fetchInvitation(db, invitationId));

  const at = now();
  const data = await unwrap(
    db
      .from("invitations")
      .update({ revoked_at: at.toISOString() })
      .eq("id", invitationId)
      .select(INVITATION_COLUMNS)
      .maybeSingle(),
  );
  if (!data) throw new MemberError("INVITATION_NOT_FOUND");
  return mapInvitation(parseData(invitationRowSchema, data), at);
}

// ---------------------------------------------------------------------------------------------
// Invitations (invitee side — the `/invite/[token]` page)
// ---------------------------------------------------------------------------------------------

/**
 * What the invite page shows before accepting. Needs a signed-in user (the middleware sends
 * signed-out visitors to `/login?next=/invite/<token>` first). Does not throw for expired/revoked/
 * used invitations — `status` says so, and {@link acceptInvitation} would fail with the matching
 * code.
 *
 * @throws {MemberError} `UNAUTHORIZED`, `INVITATION_NOT_FOUND` (also for a malformed token),
 *   `MEMBER_ACTION_FAILED`.
 */
export async function getInvitation(
  db: MembersDb,
  input: InvitationTokenInput,
): Promise<InvitationPreview> {
  const parsed = invitationTokenInputSchema.safeParse(input);
  // A malformed token can never match: same answer as an unknown one.
  if (!parsed.success) throw new MemberError("INVITATION_NOT_FOUND", { cause: parsed.error });
  await requireUserId(db);

  const data = await unwrap(db.rpc("get_invitation", { p_token: parsed.data.token }));
  const [row] = parseData(
    z.array(
      z.object({
        invitation_id: z.guid(),
        space_id: z.guid(),
        space_slug: z.string(),
        space_name: z.string(),
        space_icon: z.string().nullable(),
        role: invitationRoleSchema,
        email: z.string(),
        inviter_name: z.string().nullable(),
        inviter_email: z.string().nullable(),
        expires_at: z.string(),
        status: z.enum(INVITATION_STATUSES),
        email_matches: z.boolean(),
      }),
    ),
    data ?? [],
  );
  if (!row) throw new MemberError("INVITATION_NOT_FOUND");
  return {
    invitationId: row.invitation_id,
    spaceId: row.space_id,
    spaceSlug: row.space_slug,
    spaceName: row.space_name,
    spaceIcon: row.space_icon,
    role: row.role,
    email: row.email,
    inviterName: row.inviter_name,
    inviterEmail: row.inviter_email,
    expiresAt: row.expires_at,
    status: row.status,
    emailMatches: row.email_matches,
  };
}

/**
 * Accepts the invitation as the signed-in user: single-use, only for the invited email, not
 * expired/revoked. Adds the membership (an existing higher role is kept) — afterwards the Space is
 * visible and `app.has_active_access` is true for a guest.
 *
 * A malformed token is reported as `INVITATION_NOT_FOUND` (it can never match).
 *
 * @throws {MemberError} `UNAUTHORIZED`, `FORBIDDEN` (deactivated account), `INVITATION_NOT_FOUND`, `INVITATION_ALREADY_USED`,
 *   `INVITATION_REVOKED`, `INVITATION_EXPIRED`, `INVITATION_EMAIL_MISMATCH`, `MEMBER_ACTION_FAILED`.
 */
export async function acceptInvitation(
  db: MembersDb,
  input: InvitationTokenInput,
): Promise<AcceptInvitationOutput> {
  const parsed = invitationTokenInputSchema.safeParse(input);
  if (!parsed.success) throw new MemberError("INVITATION_NOT_FOUND", { cause: parsed.error });
  await requireUserId(db);

  const data = await unwrap(db.rpc("accept_invitation", { p_token: parsed.data.token }));
  const [row] = parseData(
    z.array(z.object({ space_id: z.guid(), space_slug: z.string(), role: roleSchema })),
    data ?? [],
  );
  if (!row) throw new MemberError("MEMBER_ACTION_FAILED");
  return { spaceId: row.space_id, spaceSlug: row.space_slug, role: row.role };
}
