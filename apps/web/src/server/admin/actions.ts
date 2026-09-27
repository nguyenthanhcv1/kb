"use server";

import { createClient } from "@/lib/supabase/server";

import { sendMail } from "../mail";
import { buildTestEmail } from "../mail/templates";

import {
  AdminError,
  addAccessEntries as addAccessEntriesCore,
  listAccessEntries as listAccessEntriesCore,
  listUsers as listUsersCore,
  previewAccessRemoval as previewAccessRemovalCore,
  removeAccessEntries as removeAccessEntriesCore,
  sendTestEmail as sendTestEmailCore,
  setUserDeactivated as setUserDeactivatedCore,
  setUserSuperAdmin as setUserSuperAdminCore,
  type AccessEntryIdsInput,
  type AccessImpact,
  type AddAccessEntriesInput,
  type AddAccessEntriesOutput,
  type AdminDb,
  type AdminErrorCode,
  type AdminUser,
  type ListAccessEntriesOutput,
  type ListUsersInput,
  type ListUsersOutput,
  type RemoveAccessEntriesOutput,
  type SendTestEmailInput,
  type SendTestEmailOutput,
  type SetUserDeactivatedInput,
  type SetUserSuperAdminInput,
} from "./index";

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
