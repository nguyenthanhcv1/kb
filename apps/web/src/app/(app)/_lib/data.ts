import { redirect } from "next/navigation";
import { cache } from "react";

import { getCurrentUser } from "@/server/auth";
import { getSpaceBySlug, listSpaces } from "@/server/space/actions";

/**
 * Per-request cached reads shared by the `(app)` layouts and pages (React `cache` dedupes the
 * layout + page calls of one render).
 */

/** Signed-in user; the middleware already redirects signed-out visitors, this is the safety net. */
export const requireUser = cache(async () => {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
});

/** Spaces visible to the user (empty on a read error: the sidebar must still render). */
export const loadSpaces = cache(async () => {
  const result = await listSpaces();
  if (!result.ok) {
    if (result.error === "FORBIDDEN") redirect("/login");
    console.error("[space] listSpaces failed", result.error);
    return [];
  }
  return result.data.spaces;
});

/** The Space of the `[spaceSlug]` segment, or `null` when it does not exist or is not visible. */
export const loadSpace = cache(async (slug: string) => {
  const result = await getSpaceBySlug({ slug: decodeURIComponent(slug) });
  if (!result.ok) {
    if (result.error === "FORBIDDEN") redirect("/login");
    throw new Error(result.error);
  }
  return result.data;
});
