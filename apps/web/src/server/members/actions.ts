"use server";

import { createClient } from "@/lib/supabase/server";

import { invitationDeps } from "./deps";

import {
  MemberError,
  acceptInvitation as acceptInvitationCore,
  addMember as addMemberCore,
  addSpaceGroup as addSpaceGroupCore,
  changeSpaceGroupRole as changeSpaceGroupRoleCore,
  changeMemberRole as changeMemberRoleCore,
  createInvitation as createInvitationCore,
  getInvitation as getInvitationCore,
  leaveSpace as leaveSpaceCore,
  listInvitations as listInvitationsCore,
  listMembers as listMembersCore,
  listSpaceGroups as listSpaceGroupsCore,
  removeMember as removeMemberCore,
  removeSpaceGroup as removeSpaceGroupCore,
  resendInvitation as resendInvitationCore,
  revokeInvitation as revokeInvitationCore,
  searchGrantableGroups as searchGrantableGroupsCore,
  searchMemberCandidates as searchMemberCandidatesCore,
  type AcceptInvitationOutput,
  type AddMemberInput,
  type ChangeMemberRoleInput,
  type CreateInvitationInput,
  type Invitation,
  type InvitationIdInput,
  type InvitationPreview,
  type InvitationTokenInput,
  type ListInvitationsInput,
  type ListInvitationsOutput,
  type ListMembersOutput,
  type ListSpaceGroupsOutput,
  type MemberErrorCode,
  type MembersDb,
  type RemoveMemberInput,
  type RemoveSpaceGroupInput,
  type SearchGrantableGroupsInput,
  type SearchGrantableGroupsOutput,
  type SearchMemberCandidatesInput,
  type SearchMemberCandidatesOutput,
  type SentInvitation,
  type SpaceGroup,
  type SpaceGroupInput,
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

export async function listSpaceGroups(
  input: SpaceIdInput,
): Promise<MemberActionResult<ListSpaceGroupsOutput>> {
  return run((db) => listSpaceGroupsCore(db, input));
}

export async function searchGrantableGroups(
  input: SearchGrantableGroupsInput,
): Promise<MemberActionResult<SearchGrantableGroupsOutput>> {
  return run((db) => searchGrantableGroupsCore(db, input));
}

export async function addSpaceGroup(
  input: SpaceGroupInput,
): Promise<MemberActionResult<SpaceGroup>> {
  return run((db) => addSpaceGroupCore(db, input));
}

export async function changeSpaceGroupRole(
  input: SpaceGroupInput,
): Promise<MemberActionResult<SpaceGroup>> {
  return run((db) => changeSpaceGroupRoleCore(db, input));
}

export async function removeSpaceGroup(
  input: RemoveSpaceGroupInput,
): Promise<MemberActionResult<void>> {
  return run((db) => removeSpaceGroupCore(db, input));
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
