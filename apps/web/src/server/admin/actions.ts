"use server";

import { headers } from "next/headers";

import { webEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

import { sendMail } from "../mail";
import { buildAccountDecisionEmail, buildTestEmail } from "../mail/templates";

import {
  AdminError,
  addAccessEntries as addAccessEntriesCore,
  approveAccount as approveAccountCore,
  listAccessEntries as listAccessEntriesCore,
  listPendingAccounts as listPendingAccountsCore,
  listUsers as listUsersCore,
  previewAccessRemoval as previewAccessRemovalCore,
  rejectAccount as rejectAccountCore,
  removeAccessEntries as removeAccessEntriesCore,
  sendTestEmail as sendTestEmailCore,
  setUserDeactivated as setUserDeactivatedCore,
  setUserSuperAdmin as setUserSuperAdminCore,
  type AccessEntryIdsInput,
  type AccessImpact,
  type AccountDecisionDeps,
  type AccountDecisionOutput,
  type AddAccessEntriesInput,
  type AddAccessEntriesOutput,
  type ApproveAccountInput,
  type AdminDb,
  type AdminErrorCode,
  type AdminUser,
  type ListAccessEntriesOutput,
  type ListPendingAccountsInput,
  type ListPendingAccountsOutput,
  type ListUsersInput,
  type ListUsersOutput,
  type RejectAccountInput,
  type RemoveAccessEntriesOutput,
  type SendTestEmailInput,
  type SendTestEmailOutput,
  type SetUserDeactivatedInput,
  type SetUserSuperAdminInput,
} from "./index";
import {
  addGroupMembers as addGroupMembersCore,
  createGroup as createGroupCore,
  deleteGroup as deleteGroupCore,
  getGroup as getGroupCore,
  listGroups as listGroupsCore,
  removeGroupMember as removeGroupMemberCore,
  searchGroupCandidates as searchGroupCandidatesCore,
  updateGroup as updateGroupCore,
  type AddGroupMembersInput,
  type AddGroupMembersOutput,
  type CreateGroupInput,
  type CreateGroupOutput,
  type DeleteGroupOutput,
  type GetGroupOutput,
  type GroupIdInput,
  type ListGroupsOutput,
  type RemoveGroupMemberInput,
  type SearchGroupCandidatesInput,
  type SearchGroupCandidatesOutput,
  type UpdateGroupInput,
} from "./groups";

/**
 * Server Actions of the T1.7a access administration contract (`./index.ts`) for `/admin/access`
 * and `/admin/users` (T1.7b). Each creates a caller-scoped Supabase client (never the service-role
 * one) and never throws for expected failures: `{ ok: false, error }` → show `errors.<error>`.
 */
export type AdminActionResult<T> = { ok: true; data: T } | { ok: false; error: AdminErrorCode };

/**
 * Supabase's ungenerated-schema client has a deeply recursive generic `from()`/`rpc()` signature;
 * narrow it here to the small structural contract of the core module.
 */
function asAdminDb(client: Awaited<ReturnType<typeof createClient>>): AdminDb {
  return client as unknown as AdminDb;
}

async function run<T>(action: (db: AdminDb) => Promise<T>): Promise<AdminActionResult<T>> {
  try {
    const data = await action(asAdminDb(await createClient()));
    return { ok: true, data };
  } catch (error) {
    if (error instanceof AdminError) return { ok: false, error: error.code };
    console.error("[admin] unexpected error", error);
    return { ok: false, error: "ADMIN_ACTION_FAILED" };
  }
}

export async function listAccessEntries(): Promise<AdminActionResult<ListAccessEntriesOutput>> {
  return run((db) => listAccessEntriesCore(db));
}

export async function addAccessEntries(
  input: AddAccessEntriesInput,
): Promise<AdminActionResult<AddAccessEntriesOutput>> {
  return run((db) => addAccessEntriesCore(db, input));
}

export async function previewAccessRemoval(
  input: AccessEntryIdsInput,
): Promise<AdminActionResult<AccessImpact>> {
  return run((db) => previewAccessRemovalCore(db, input));
}

export async function removeAccessEntries(
  input: AccessEntryIdsInput,
): Promise<AdminActionResult<RemoveAccessEntriesOutput>> {
  return run((db) => removeAccessEntriesCore(db, input));
}

export async function listUsers(
  input?: ListUsersInput,
): Promise<AdminActionResult<ListUsersOutput>> {
  return run((db) => listUsersCore(db, input));
}

export async function setUserDeactivated(
  input: SetUserDeactivatedInput,
): Promise<AdminActionResult<AdminUser>> {
  return run((db) => setUserDeactivatedCore(db, input));
}

export async function setUserSuperAdmin(
  input: SetUserSuperAdminInput,
): Promise<AdminActionResult<AdminUser>> {
  return run((db) => setUserSuperAdminCore(db, input));
}

export async function sendTestEmail(
  input: SendTestEmailInput = {},
): Promise<AdminActionResult<SendTestEmailOutput>> {
  return run((db) => sendTestEmailCore(db, input, { sendMail, buildTestEmail }));
}

export async function listPendingAccounts(
  input?: ListPendingAccountsInput,
): Promise<AdminActionResult<ListPendingAccountsOutput>> {
  return run((db) => listPendingAccountsCore(db, input));
}

/** `APP_URL` (required when deployed), else the request origin (local dev). */
async function accountDecisionDeps(): Promise<AccountDecisionDeps> {
  let appUrl = webEnv().APP_URL;
  if (!appUrl) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
    const proto = h.get("x-forwarded-proto") ?? "http";
    appUrl = h.get("origin") ?? `${proto}://${host}`;
  }
  return { sendMail, buildAccountDecisionEmail, appUrl };
}

export async function approveAccount(
  input: ApproveAccountInput,
): Promise<AdminActionResult<AccountDecisionOutput>> {
  return run(async (db) => approveAccountCore(db, input, await accountDecisionDeps()));
}

export async function rejectAccount(
  input: RejectAccountInput,
): Promise<AdminActionResult<AccountDecisionOutput>> {
  return run(async (db) => rejectAccountCore(db, input, await accountDecisionDeps()));
}

export async function listGroups(): Promise<AdminActionResult<ListGroupsOutput>> {
  return run((db) => listGroupsCore(db));
}

export async function getGroup(input: GroupIdInput): Promise<AdminActionResult<GetGroupOutput>> {
  return run((db) => getGroupCore(db, input));
}

export async function createGroup(
  input: CreateGroupInput,
): Promise<AdminActionResult<CreateGroupOutput>> {
  return run((db) => createGroupCore(db, input));
}

export async function updateGroup(input: UpdateGroupInput): Promise<AdminActionResult<null>> {
  return run(async (db) => {
    await updateGroupCore(db, input);
    return null;
  });
}

export async function deleteGroup(
  input: GroupIdInput,
): Promise<AdminActionResult<DeleteGroupOutput>> {
  return run((db) => deleteGroupCore(db, input));
}

export async function addGroupMembers(
  input: AddGroupMembersInput,
): Promise<AdminActionResult<AddGroupMembersOutput>> {
  return run((db) => addGroupMembersCore(db, input));
}

export async function removeGroupMember(
  input: RemoveGroupMemberInput,
): Promise<AdminActionResult<null>> {
  return run(async (db) => {
    await removeGroupMemberCore(db, input);
    return null;
  });
}

export async function searchGroupCandidates(
  input: SearchGroupCandidatesInput,
): Promise<AdminActionResult<SearchGroupCandidatesOutput>> {
  return run((db) => searchGroupCandidatesCore(db, input));
}
