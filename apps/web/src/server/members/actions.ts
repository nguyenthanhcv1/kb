"use server";

import { headers } from "next/headers";

import { webEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { mailerFromEnv, type Mailer } from "@/server/email/mailer";

import {
  MemberError,
  acceptInvitation as acceptInvitationCore,
  addMember as addMemberCore,
  changeMemberRole as changeMemberRoleCore,
  createInvitation as createInvitationCore,
  getInvitation as getInvitationCore,
  leaveSpace as leaveSpaceCore,
  listInvitations as listInvitationsCore,
  listMembers as listMembersCore,
  removeMember as removeMemberCore,
  resendInvitation as resendInvitationCore,
  revokeInvitation as revokeInvitationCore,
  searchMemberCandidates as searchMemberCandidatesCore,
  type AcceptInvitationOutput,
  type AddMemberInput,
  type ChangeMemberRoleInput,
  type CreateInvitationInput,
  type Invitation,
  type InvitationDeps,
  type InvitationIdInput,
  type InvitationPreview,
  type InvitationTokenInput,
  type ListInvitationsInput,
  type ListInvitationsOutput,
  type ListMembersOutput,
  type MemberErrorCode,
  type MembersDb,
  type RemoveMemberInput,
  type SearchMemberCandidatesInput,
  type SearchMemberCandidatesOutput,
  type SentInvitation,
  type SpaceIdInput,
  type SpaceMember,
} from "./index";

/**
 * Server Action wrappers of the T1.5a members/invitations contract (`./index.ts`). Each creates a
 * caller-scoped Supabase client (never service_role) and returns a serializable result — expected
 * failures come back as `{ ok: false, error: <code> }` → the UI shows `errors.<code>`.
 */
export type MemberActionResult<T> = { ok: true; data: T } | { ok: false; error: MemberErrorCode };

type Client = Awaited<ReturnType<typeof createClient>>;

/** See `space/actions.ts`: narrow supabase-js's deep generics to the structural port at the boundary. */
function asMembersDb(client: Client): MembersDb {
  return client as unknown as MembersDb;
}

async function run<T>(action: (db: MembersDb) => Promise<T>): Promise<MemberActionResult<T>> {
  try {
    const data = await action(asMembersDb(await createClient()));
    return { ok: true, data };
  } catch (error) {
    if (error instanceof MemberError) return { ok: false, error: error.code };
    console.error("[members] unexpected error", error);
    return { ok: false, error: "MEMBER_ACTION_FAILED" };
  }
}

let cachedMailer: Mailer | null | undefined;

/** `APP_URL` (required when deployed), else the request origin (local dev). */
async function invitationDeps(): Promise<InvitationDeps> {
  const env = webEnv();
  cachedMailer ??= mailerFromEnv(env);
  let appUrl = env.APP_URL;
  if (!appUrl) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
    const proto = h.get("x-forwarded-proto") ?? "http";
    appUrl = h.get("origin") ?? `${proto}://${host}`;
  }
  return { appUrl, mailer: cachedMailer };
}

export async function listMembers(
  input: SpaceIdInput,
): Promise<MemberActionResult<ListMembersOutput>> {
  return run((db) => listMembersCore(db, input));
}

export async function searchMemberCandidates(
  input: SearchMemberCandidatesInput,
): Promise<MemberActionResult<SearchMemberCandidatesOutput>> {
  return run((db) => searchMemberCandidatesCore(db, input));
}

export async function addMember(input: AddMemberInput): Promise<MemberActionResult<SpaceMember>> {
  return run((db) => addMemberCore(db, input));
}

export async function changeMemberRole(
  input: ChangeMemberRoleInput,
): Promise<MemberActionResult<SpaceMember>> {
  return run((db) => changeMemberRoleCore(db, input));
}

export async function removeMember(input: RemoveMemberInput): Promise<MemberActionResult<void>> {
  return run((db) => removeMemberCore(db, input));
}

export async function leaveSpace(input: SpaceIdInput): Promise<MemberActionResult<void>> {
  return run((db) => leaveSpaceCore(db, input));
}

export async function listInvitations(
  input: ListInvitationsInput,
): Promise<MemberActionResult<ListInvitationsOutput>> {
  return run((db) => listInvitationsCore(db, input));
}

export async function createInvitation(
  input: CreateInvitationInput,
): Promise<MemberActionResult<SentInvitation>> {
  return run(async (db) => createInvitationCore(db, input, await invitationDeps()));
}

export async function resendInvitation(
  input: InvitationIdInput,
): Promise<MemberActionResult<SentInvitation>> {
  return run(async (db) => resendInvitationCore(db, input, await invitationDeps()));
}

export async function revokeInvitation(
  input: InvitationIdInput,
): Promise<MemberActionResult<Invitation>> {
  return run((db) => revokeInvitationCore(db, input));
}

/** For the `/invite/[token]` page (T1.5b); a Server Component may also call the core directly. */
export async function getInvitation(
  input: InvitationTokenInput,
): Promise<MemberActionResult<InvitationPreview>> {
  return run((db) => getInvitationCore(db, input));
}

/** "Accept" button on `/invite/[token]`; on success redirect to `/s/<spaceSlug>`. */
export async function acceptInvitation(
  input: InvitationTokenInput,
): Promise<MemberActionResult<AcceptInvitationOutput>> {
  return run((db) => acceptInvitationCore(db, input));
}
