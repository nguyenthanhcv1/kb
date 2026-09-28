import type { AdminUser } from "@/server/admin";

export type UserAction = "lock" | "unlock" | "grant" | "revoke";

export type UserActionItem = { action: UserAction; disabled: boolean };

/**
 * Actions offered for a user in `/admin/users`, mirroring what the server allows: nobody locks
 * themselves or revokes their own super admin (`USER_CANNOT_CHANGE_SELF`); guests and locked users
 * cannot become super admins (`USER_IS_GUEST`, `USER_DEACTIVATED`). The server re-checks all of it
 * (and `LAST_SUPER_ADMIN`).
 */
export function userActions(
  user: Pick<AdminUser, "isSelf" | "isGuest" | "isSuperAdmin" | "deactivatedAt">,
): UserActionItem[] {
  const deactivated = user.deactivatedAt !== null;
  return [
    deactivated ? { action: "unlock", disabled: false } : { action: "lock", disabled: user.isSelf },
    user.isSuperAdmin
      ? { action: "revoke", disabled: user.isSelf }
      : { action: "grant", disabled: user.isGuest || deactivated },
  ];
}

/** Server Action input for an action. */
export function userActionInput(
  action: UserAction,
  userId: string,
):
  | { kind: "deactivate"; input: { userId: string; deactivated: boolean } }
  | { kind: "superAdmin"; input: { userId: string; superAdmin: boolean } } {
  switch (action) {
    case "lock":
    case "unlock":
      return { kind: "deactivate", input: { userId, deactivated: action === "lock" } };
    case "grant":
    case "revoke":
      return { kind: "superAdmin", input: { userId, superAdmin: action === "grant" } };
  }
}
