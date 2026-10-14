"use server";

import { createClient } from "@/lib/supabase/server";
import { invitationDeps } from "@/server/members/deps";

import {
  PageShareError,
  changePageShareRole,
  leaveSharedPage,
  listPageShares,
  removePageShare,
  sharePage,
  type ChangePageShareRoleInput,
  type ListPageSharesOutput,
  type PageShareErrorCode,
  type PageShareIdInput,
  type PageShareTargetInput,
  type SharePageInput,
  type SharePageOutput,
} from "./index";

/**
 * Server Actions of the page sharing contract (`./index.ts`): caller-scoped client (never
 * service_role), expected failures as `{ ok: false, error }` → the UI shows `errors.<code>`.
 */
export type PageShareActionResult<T> =
  { ok: true; data: T } | { ok: false; error: PageShareErrorCode };

async function run<T>(
  action: (supabase: Awaited<ReturnType<typeof createClient>>) => Promise<T>,
): Promise<PageShareActionResult<T>> {
  try {
    return { ok: true, data: await action(await createClient()) };
  } catch (error) {
    if (error instanceof PageShareError) return { ok: false, error: error.code };
    console.error("[page-shares] unexpected error", error);
    return { ok: false, error: "PAGE_SHARE_FAILED" };
  }
}

export async function listPageSharesAction(
  input: PageShareIdInput,
): Promise<PageShareActionResult<ListPageSharesOutput>> {
  return run((supabase) => listPageShares(supabase, input));
}

export async function sharePageAction(
  input: SharePageInput,
): Promise<PageShareActionResult<SharePageOutput>> {
  return run(async (supabase) => sharePage(supabase, input, await invitationDeps()));
}

export async function changePageShareRoleAction(
  input: ChangePageShareRoleInput,
): Promise<PageShareActionResult<void>> {
  return run((supabase) => changePageShareRole(supabase, input));
}

export async function removePageShareAction(
  input: PageShareTargetInput,
): Promise<PageShareActionResult<void>> {
  return run((supabase) => removePageShare(supabase, input));
}

export async function leaveSharedPageAction(
  input: PageShareIdInput,
): Promise<PageShareActionResult<void>> {
  return run((supabase) => leaveSharedPage(supabase, input));
}
