"use server";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { CollabError, restorePageVersion } from "@/server/collab";

import type { VersionErrorCode } from "./index";

/**
 * Server Action behind the "Restore" button of the version history (T6.3b). Never throws for
 * expected failures: `{ ok: false, code }` → show `errors.<code>`.
 *
 * ```ts
 * const result = await restorePageVersionAction({ pageId, versionId });
 * // { ok: true, data: { versionNo: 13, restoredFromVersionNo: 4, preRestoreVersionNo: 12 } }
 * // { ok: false, code: "FORBIDDEN" }   // viewer (kb-collab checks the role again)
 * ```
 */
export type RestoreVersionActionResult =
  | {
      ok: true;
      data: {
        /** The new `restore` version. */
        versionNo: number;
        restoredFromVersionNo: number;
        /** Content as it was just before: restore this version to undo. */
        preRestoreVersionNo: number;
      };
    }
  | { ok: false; code: VersionErrorCode | "UNAUTHORIZED" | "PAGE_NOT_FOUND" };

const inputSchema = z.object({ pageId: z.guid(), versionId: z.guid() });

export async function restorePageVersionAction(input: {
  pageId: string;
  versionId: string;
}): Promise<RestoreVersionActionResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION_FAILED" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "UNAUTHORIZED" };

  try {
    const result = await restorePageVersion({ ...parsed.data, actorId: user.id });
    return {
      ok: true,
      data: {
        versionNo: result.versionNo,
        restoredFromVersionNo: result.restoredFromVersionNo,
        preRestoreVersionNo: result.preRestoreVersionNo,
      },
    };
  } catch (error) {
    if (error instanceof CollabError) {
      if (error.code === "PAGE_ACTION_FAILED") {
        console.error("[versions] restore failed", error.reason, error.cause);
      }
      return { ok: false, code: error.code };
    }
    console.error("[versions] unexpected error", error);
    return { ok: false, code: "PAGE_ACTION_FAILED" };
  }
}
