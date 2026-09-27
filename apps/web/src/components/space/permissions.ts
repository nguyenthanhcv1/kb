import type { SpaceRole } from "@/server/space";

/**
 * What the Space UI shows to whom. These only hide controls: the real check is RLS
 * (`spaces_insert` needs `app.is_internal_user()`, `spaces_update` needs `app.is_space_admin()`).
 */

/** Guests (signed in through an invitation) cannot create Spaces. */
export function canCreateSpace(user: { isGuest: boolean } | null | undefined): boolean {
  return Boolean(user && !user.isGuest);
}

/** Settings, members and archive: Space admins only (super admins resolve to `admin`). */
export function canManageSpace(role: SpaceRole | null | undefined): boolean {
  return role === "admin";
}

/** Creating and editing pages: editors and admins; viewers only read. */
export function canEditSpaceContent(role: SpaceRole | null | undefined): boolean {
  return role === "editor" || role === "admin";
}
