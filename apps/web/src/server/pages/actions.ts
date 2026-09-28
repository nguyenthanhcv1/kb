"use server";

import { createClient } from "@/lib/supabase/server";

import {
  createPage,
  type CreatePageInput,
  listChildPages,
  type ListChildPagesInput,
  listPageAncestors,
  movePage,
  type MovePageInput,
  PageError,
  type PageErrorCode,
  type PageIdInput,
  type PageSummary,
  type PageTreeNode,
  purgePage,
  renamePage,
  type RenamePageInput,
  restorePage,
  setPageIcon,
  type SetPageIconInput,
  trashPage,
} from "./index";

/**
 * Server Actions for the page tree UI (T2.3 sidebar, T2.4 page/trash). They never throw for
 * expected failures: `{ ok: false, code }` → show `errors.<code>`.
 */
export type PageActionResult<T> = { ok: true; data: T } | { ok: false; code: PageErrorCode };

async function run<T>(action: (supabase: Awaited<ReturnType<typeof createClient>>) => Promise<T>) {
  try {
    const data = await action(await createClient());
    return { ok: true, data } as const;
  } catch (error) {
    if (error instanceof PageError) return { ok: false, code: error.code } as const;
    console.error("[pages] unexpected error", error);
    return { ok: false, code: "PAGE_ACTION_FAILED" } as const;
  }
}

/** Live children of `parentId` (`null` = roots) in order — the sidebar tree loads one level at a time. */
export async function listChildPagesAction(
  input: ListChildPagesInput,
): Promise<PageActionResult<PageTreeNode[]>> {
  return run((supabase) => listChildPages(supabase, input));
}

/** Ancestors of a page, root first (breadcrumb). */
export async function listPageAncestorsAction(
  input: PageIdInput,
): Promise<PageActionResult<PageSummary[]>> {
  return run((supabase) => listPageAncestors(supabase, input));
}

export async function createPageAction(
  input: CreatePageInput,
): Promise<PageActionResult<PageSummary>> {
  return run((supabase) => createPage(supabase, input));
}

export async function renamePageAction(
  input: RenamePageInput,
): Promise<PageActionResult<PageSummary>> {
  return run((supabase) => renamePage(supabase, input));
}

export async function setPageIconAction(
  input: SetPageIconInput,
): Promise<PageActionResult<PageSummary>> {
  return run((supabase) => setPageIcon(supabase, input));
}

export async function movePageAction(input: MovePageInput): Promise<PageActionResult<PageSummary>> {
  return run((supabase) => movePage(supabase, input));
}

export async function trashPageAction(input: PageIdInput): Promise<PageActionResult<PageSummary>> {
  return run((supabase) => trashPage(supabase, input));
}

export async function restorePageAction(
  input: PageIdInput,
): Promise<PageActionResult<PageSummary>> {
  return run((supabase) => restorePage(supabase, input));
}

export async function purgePageAction(input: PageIdInput): Promise<PageActionResult<null>> {
  return run(async (supabase) => {
    await purgePage(supabase, input);
    return null;
  });
}
