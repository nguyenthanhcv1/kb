import { isLocale, type Locale } from "@kb/i18n";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { pageHref } from "@/lib/page-href";
import { renderPageSharedEmail } from "@/server/email/invitation-email";
import {
  INVITATION_COLUMNS,
  INVITATION_ROLES,
  INVITATION_TTL_DAYS,
  addDays,
  deliverInvitation,
  generateInvitationToken,
  hashInvitationToken,
  invitationRowSchema,
  invitationUrl,
  mapInvitation,
  type EmailStatus,
  type Invitation,
  type InvitationDeps,
  type MembersDb,
} from "@/server/members";

/**
 * Page sharing contract (migration `*_page_permissions.sql`).
 *
 * A share gives one person `viewer` or `editor` on a page and all its subpages, on top of their
 * Space role (the highest wins; a share is never admin). Only Space admins share; RLS
 * (`app.can_share_page`) and the SECURITY DEFINER functions `public.share_page` /
 * `public.list_page_shares` decide, this module validates input and maps rows and errors.
 *
 * Sharing is by email: an existing account gets the share at once (and a best-effort "shared with
 * you" email); an email without an account gets a page invitation — the regular invite flow
 * (`/invite/<token>`, 14 days) that grants the share when accepted.
 *
 * ```ts
 * const { shares, invitations } = await listPageShares(supabase, { pageId });
 * // shares: [{ userId: "5d2f…0003", email: "khach@partner.vn", role: "viewer", isGuest: true,
 * //            inherited: false, sourcePageId: pageId, sourcePageTitle: "Hợp đồng", … }]
 * const result = await sharePage(supabase, { pageId, email: "khach@partner.vn", role: "viewer" }, deps);
 * // { status: "granted", userId: "5d2f…0003", emailStatus: "sent" }
 * // or { status: "invited", invitation: { id, status: "pending", … }, inviteUrl, emailStatus }
 * await changePageShareRole(supabase, { pageId, userId, role: "editor" });
 * await removePageShare(supabase, { pageId, userId });
 * const shared = await listSharedWithMe(supabase); // sidebar "Shared with me"
 * ```
 *
 * Errors: {@link PageShareError} with a code from {@link PAGE_SHARE_ERROR_CODES} → `errors.<code>`.
 */

export const PAGE_SHARE_ERROR_CODES = [
  "FORBIDDEN",
  "INVITATION_ALREADY_PENDING",
  "PAGE_NOT_FOUND",
  "PAGE_SHARE_FAILED",
  "PAGE_SHARE_NOT_FOUND",
  "PAGE_SHARE_USER_INACTIVE",
  "RATE_LIMITED",
  "UNAUTHORIZED",
  "VALIDATION_FAILED",
] as const;
export type PageShareErrorCode = (typeof PAGE_SHARE_ERROR_CODES)[number];

export class PageShareError extends Error {
  constructor(
    readonly code: PageShareErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = "PageShareError";
  }
}

/** A share is never admin (DB check `role in ('viewer', 'editor')`). */
export const PAGE_SHARE_ROLES = INVITATION_ROLES;
export type PageShareRole = (typeof PAGE_SHARE_ROLES)[number];

const roleSchema = z.enum(PAGE_SHARE_ROLES);

export const pageIdInputSchema = z.object({ pageId: z.guid() });
export type PageShareIdInput = z.input<typeof pageIdInputSchema>;

export const sharePageInputSchema = z.object({
  pageId: z.guid(),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  role: roleSchema,
});
export type SharePageInput = z.input<typeof sharePageInputSchema>;

export const pageShareTargetInputSchema = z.object({ pageId: z.guid(), userId: z.guid() });
export type PageShareTargetInput = z.input<typeof pageShareTargetInputSchema>;

export const changePageShareRoleInputSchema = pageShareTargetInputSchema.extend({
  role: roleSchema,
});
export type ChangePageShareRoleInput = z.input<typeof changePageShareRoleInputSchema>;

export const pageShareSchema = z.object({
  userId: z.guid(),
  email: z.string(),
  fullName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  isGuest: z.boolean(),
  role: roleSchema,
  /** Shared on an ancestor: shown read-only ("from <page>"), managed on that page. */
  inherited: z.boolean(),
  sourcePageId: z.guid(),
  /** User content, not translated (empty = untitled). */
  sourcePageTitle: z.string(),
  grantedBy: z.guid().nullable(),
  /** ISO 8601 (UTC). */
  createdAt: z.string(),
});
export type PageShare = z.infer<typeof pageShareSchema>;

export type ListPageSharesOutput = { shares: PageShare[]; invitations: Invitation[] };

export type SharePageOutput =
  | { status: "granted"; userId: string; role: PageShareRole; emailStatus: EmailStatus }
  | { status: "invited"; invitation: Invitation; inviteUrl: string; emailStatus: EmailStatus };

export const sharedPageSchema = z.object({
  pageId: z.guid(),
  shortId: z.string(),
  slug: z.string(),
  title: z.string(),
  icon: z.string().nullable(),
  spaceId: z.guid(),
  spaceSlug: z.string(),
  spaceName: z.string(),
  spaceIcon: z.string().nullable(),
  role: roleSchema,
  sharedAt: z.string(),
  /** Has live subpages (the sidebar offers to expand it). */
  hasChildren: z.boolean(),
});
export type SharedPage = z.infer<typeof sharedPageSchema>;

/** Example output — base for UI mocks and tests. */
export const listPageSharesExample: ListPageSharesOutput = {
  shares: [
    {
      userId: "5d2f0000-0000-4000-8000-000000000003",
      email: "khach@partner.vn",
      fullName: "Trần Khách",
      avatarUrl: null,
      isGuest: true,
      role: "viewer",
      inherited: false,
      sourcePageId: "20000000-0000-4000-8000-000000000001",
      sourcePageTitle: "Hợp đồng đối tác",
      grantedBy: "5d2f0000-0000-4000-8000-000000000002",
      createdAt: "2026-10-14T02:00:00+00:00",
    },
  ],
  invitations: [],
};

// ---------------------------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------------------------

type PostgrestErrorLike = { code?: string; message?: string } | null | undefined;

const DB_CODES = new Set<PageShareErrorCode>([
  "FORBIDDEN",
  "PAGE_NOT_FOUND",
  "PAGE_SHARE_USER_INACTIVE",
  "RATE_LIMITED",
  "VALIDATION_FAILED",
]);

/** DB error → code: raised codes pass through, privilege/RLS errors become FORBIDDEN. */
export function toPageShareError(error: PostgrestErrorLike | unknown): PageShareError {
  if (error instanceof PageShareError) return error;
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  if (message && DB_CODES.has(message as PageShareErrorCode)) {
    return new PageShareError(message as PageShareErrorCode, { cause: error });
  }
  if (code === "42501") return new PageShareError("FORBIDDEN", { cause: error });
  if (code === "22P02" || code === "23514" || code === "22023")
    return new PageShareError("VALIDATION_FAILED", { cause: error });
  return new PageShareError("PAGE_SHARE_FAILED", { cause: error });
}

function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new PageShareError("VALIDATION_FAILED", { cause: result.error });
  return result.data;
}

function parseData<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw new PageShareError("PAGE_SHARE_FAILED", { cause: result.error });
  return result.data;
}

async function requireUserId(supabase: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new PageShareError("UNAUTHORIZED");
  return user.id;
}

const pageInfoSchema = z.object({
  id: z.guid(),
  space_id: z.guid(),
  short_id: z.string(),
  slug: z.string(),
  title: z.string(),
  space: z.object({ slug: z.string(), name: z.string() }),
});
type PageInfo = z.infer<typeof pageInfoSchema>;

/** The live page with its Space, as the caller sees it — else PAGE_NOT_FOUND. */
async function requirePage(supabase: SupabaseClient, pageId: string): Promise<PageInfo> {
  const { data, error } = await supabase
    .from("pages")
    .select("id, space_id, short_id, slug, title, space:spaces!inner(slug, name)")
    .eq("id", pageId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw toPageShareError(error);
  if (!data) throw new PageShareError("PAGE_NOT_FOUND");
  return parseData(pageInfoSchema, data);
}

const shareRowSchema = z
  .object({
    user_id: z.guid(),
    email: z.string(),
    full_name: z.string().nullable(),
    avatar_url: z.string().nullable(),
    is_guest: z.boolean(),
    role: roleSchema,
    source_page_id: z.guid(),
    source_page_title: z.string(),
    inherited: z.boolean(),
    granted_by: z.guid().nullable(),
    created_at: z.string(),
  })
  .transform((row): PageShare => ({
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    isGuest: row.is_guest,
    role: row.role,
    inherited: row.inherited,
    sourcePageId: row.source_page_id,
    sourcePageTitle: row.source_page_title,
    grantedBy: row.granted_by,
    createdAt: row.created_at,
  }));

/** "Shared with you" email to an existing account; never throws (`failed` is logged). */
async function notifyShare(
  supabase: SupabaseClient,
  page: PageInfo,
  share: { email: string; role: PageShareRole; locale: string | null },
  callerId: string,
  deps: InvitationDeps,
): Promise<EmailStatus> {
  if (!deps.mailer) return "skipped";
  try {
    const { data: sharer } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", callerId)
      .maybeSingle();
    const sharerRow = sharer as { full_name?: string | null; email?: string } | null;
    const locales: Locale[] = isLocale(share.locale) ? [share.locale] : ["vi", "en"];
    const message = await renderPageSharedEmail({
      to: share.email,
      locales,
      sharerName: sharerRow?.full_name || sharerRow?.email || "",
      spaceName: page.space.name,
      pageTitle: page.title,
      role: share.role,
      pageUrl: `${deps.appUrl.replace(/\/+$/, "")}${pageHref(page.space.slug, {
        slug: page.slug,
        shortId: page.short_id,
      })}`,
    });
    await deps.mailer.send({ ...message, replyTo: sharerRow?.email });
    return "sent";
  } catch (error) {
    console.error("[page-shares] share email failed", { pageId: page.id, error });
    return "failed";
  }
}

// ---------------------------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------------------------

/**
 * Who a page is shared with (direct shares first, then the ones inherited from ancestors) and its
 * pending page invitations. Space admins only.
 *
 * @throws {PageShareError} `VALIDATION_FAILED`, `UNAUTHORIZED`, `PAGE_NOT_FOUND`, `FORBIDDEN`,
 *   `PAGE_SHARE_FAILED`.
 */
export async function listPageShares(
  supabase: SupabaseClient,
  input: PageShareIdInput,
  now: () => Date = () => new Date(),
): Promise<ListPageSharesOutput> {
  const { pageId } = parseInput(pageIdInputSchema, input);
  await requireUserId(supabase);
  await requirePage(supabase, pageId);

  const { data, error } = await supabase.rpc("list_page_shares", { p_page_id: pageId });
  if (error) throw toPageShareError(error);
  const shares = parseData(z.array(shareRowSchema), data ?? []);

  const { data: rows, error: invitationError } = await supabase
    .from("invitations")
    .select(INVITATION_COLUMNS)
    .eq("page_id", pageId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (invitationError) throw toPageShareError(invitationError);
  const at = now();
  const invitations = parseData(z.array(invitationRowSchema), rows ?? []).map((row) =>
    mapInvitation(row, at),
  );
  return { shares, invitations };
}

/**
 * Shares a page by email (Space admins only). An existing account gets the share at once — or its
 * role on this page changes — and a best-effort email; an email without an account gets a page
 * invitation (14 days) sent by email, whose link the admin can also copy (`inviteUrl`).
 *
 * @throws {PageShareError} `VALIDATION_FAILED`, `UNAUTHORIZED`, `PAGE_NOT_FOUND`, `FORBIDDEN`,
 *   `PAGE_SHARE_USER_INACTIVE` (locked/rejected account), `INVITATION_ALREADY_PENDING`,
 *   `RATE_LIMITED`, `PAGE_SHARE_FAILED`.
 */
export async function sharePage(
  supabase: SupabaseClient,
  input: SharePageInput,
  deps: InvitationDeps,
): Promise<SharePageOutput> {
  const parsed = parseInput(sharePageInputSchema, input);
  const callerId = await requireUserId(supabase);
  const now = deps.now?.() ?? new Date();
  const page = await requirePage(supabase, parsed.pageId);

  const { data, error } = await supabase.rpc("share_page", {
    p_page_id: parsed.pageId,
    p_email: parsed.email,
    p_role: parsed.role,
  });
  if (error) throw toPageShareError(error);
  const [result] = parseData(
    z.array(
      z.object({
        status: z.enum(["granted", "no_account"]),
        user_id: z.guid().nullable(),
        role: roleSchema,
        locale: z.string().nullable(),
      }),
    ),
    data ?? [],
  );
  if (!result) throw new PageShareError("PAGE_SHARE_FAILED");

  if (result.status === "granted" && result.user_id) {
    const emailStatus = await notifyShare(
      supabase,
      page,
      { email: parsed.email, role: result.role, locale: result.locale },
      callerId,
      deps,
    );
    return { status: "granted", userId: result.user_id, role: result.role, emailStatus };
  }

  const { data: pending, error: pendingError } = await supabase
    .from("invitations")
    .select("id")
    .eq("page_id", parsed.pageId)
    .eq("email", parsed.email)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", now.toISOString());
  if (pendingError) throw toPageShareError(pendingError);
  if (Array.isArray(pending) && pending.length > 0) {
    throw new PageShareError("INVITATION_ALREADY_PENDING");
  }

  const token = generateInvitationToken();
  const { data: row, error: insertError } = await supabase
    .from("invitations")
    .insert({
      // The DB sets the Space of the page (trigger `invitations_0_page_space`).
      space_id: page.space_id,
      page_id: parsed.pageId,
      email: parsed.email,
      role: parsed.role,
      token_hash: hashInvitationToken(token),
      invited_by: callerId,
      expires_at: addDays(now, INVITATION_TTL_DAYS).toISOString(),
    })
    .select(INVITATION_COLUMNS)
    .single();
  if (insertError) throw toPageShareError(insertError);

  const invitationRow = parseData(invitationRowSchema, row);
  const inviteUrl = invitationUrl(deps.appUrl, token);
  const emailStatus = await deliverInvitation(
    supabase as unknown as MembersDb,
    invitationRow,
    inviteUrl,
    callerId,
    deps,
  );
  return {
    status: "invited",
    invitation: mapInvitation(invitationRow, now),
    inviteUrl,
    emailStatus,
  };
}

async function writeShare(
  query: PromiseLike<{ data: unknown; error: PostgrestErrorLike }>,
): Promise<void> {
  const { data, error } = await query;
  if (error) throw toPageShareError(error);
  if (!Array.isArray(data) || data.length === 0) throw new PageShareError("PAGE_SHARE_NOT_FOUND");
}

/**
 * Changes the role of a person's share on this page (Space admins only; inherited shares are
 * changed on their own page).
 *
 * @throws {PageShareError} `VALIDATION_FAILED`, `UNAUTHORIZED`, `PAGE_NOT_FOUND`,
 *   `PAGE_SHARE_NOT_FOUND` (also: not a Space admin), `PAGE_SHARE_FAILED`.
 */
export async function changePageShareRole(
  supabase: SupabaseClient,
  input: ChangePageShareRoleInput,
): Promise<void> {
  const { pageId, userId, role } = parseInput(changePageShareRoleInputSchema, input);
  await requireUserId(supabase);
  await requirePage(supabase, pageId);
  await writeShare(
    supabase
      .from("page_permissions")
      .update({ role })
      .eq("page_id", pageId)
      .eq("user_id", userId)
      .select("user_id"),
  );
}

/**
 * Stops sharing the page with a person (Space admins only).
 *
 * @throws {PageShareError} `VALIDATION_FAILED`, `UNAUTHORIZED`, `PAGE_NOT_FOUND`,
 *   `PAGE_SHARE_NOT_FOUND` (also: not a Space admin), `PAGE_SHARE_FAILED`.
 */
export async function removePageShare(
  supabase: SupabaseClient,
  input: PageShareTargetInput,
): Promise<void> {
  const { pageId, userId } = parseInput(pageShareTargetInputSchema, input);
  await requireUserId(supabase);
  await requirePage(supabase, pageId);
  await writeShare(
    supabase
      .from("page_permissions")
      .delete()
      .eq("page_id", pageId)
      .eq("user_id", userId)
      .select("user_id"),
  );
}

/**
 * The caller removes a page shared with them from their list (and loses that access).
 *
 * @throws {PageShareError} `VALIDATION_FAILED`, `UNAUTHORIZED`, `PAGE_SHARE_NOT_FOUND`,
 *   `PAGE_SHARE_FAILED`.
 */
export async function leaveSharedPage(
  supabase: SupabaseClient,
  input: PageShareIdInput,
): Promise<void> {
  const { pageId } = parseInput(pageIdInputSchema, input);
  const callerId = await requireUserId(supabase);
  await writeShare(
    supabase
      .from("page_permissions")
      .delete()
      .eq("page_id", pageId)
      .eq("user_id", callerId)
      .select("user_id"),
  );
}

const sharedRowSchema = z
  .object({
    page_id: z.guid(),
    short_id: z.string(),
    slug: z.string(),
    title: z.string(),
    icon: z.string().nullable(),
    space_id: z.guid(),
    space_slug: z.string(),
    space_name: z.string(),
    space_icon: z.string().nullable(),
    role: roleSchema,
    shared_at: z.string(),
    has_children: z.boolean(),
  })
  .transform((row): SharedPage => ({
    pageId: row.page_id,
    shortId: row.short_id,
    slug: row.slug,
    title: row.title,
    icon: row.icon,
    spaceId: row.space_id,
    spaceSlug: row.space_slug,
    spaceName: row.space_name,
    spaceIcon: row.space_icon,
    role: row.role,
    sharedAt: row.shared_at,
    hasChildren: row.has_children,
  }));

/**
 * Pages shared directly with the caller (live, in active Spaces), newest share first — the
 * sidebar "Shared with me" section.
 *
 * @throws {PageShareError} `UNAUTHORIZED`, `PAGE_SHARE_FAILED`.
 */
export async function listSharedWithMe(supabase: SupabaseClient): Promise<SharedPage[]> {
  await requireUserId(supabase);
  const { data, error } = await supabase.rpc("list_shared_with_me");
  if (error) throw toPageShareError(error);
  return parseData(z.array(sharedRowSchema), data ?? []);
}

/**
 * The caller's role on a page (`null` = no access) — Space role raised by page shares. Lets the
 * page route decide what to show to someone who reaches a page only through a share.
 *
 * @throws {PageShareError} `PAGE_SHARE_FAILED`.
 */
export async function getMyPageRole(
  supabase: SupabaseClient,
  input: PageShareIdInput,
): Promise<"viewer" | "editor" | "admin" | null> {
  const { pageId } = parseInput(pageIdInputSchema, input);
  const { data, error } = await supabase.rpc("my_page_role", { p_page_id: pageId });
  if (error) throw toPageShareError(error);
  return parseData(z.enum(["viewer", "editor", "admin"]).nullable(), data ?? null);
}
