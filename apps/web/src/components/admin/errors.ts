import { ADMIN_ERROR_CODES, type AdminErrorCode } from "@/server/admin";

/** Translation key (in the `errors` namespace) for an admin action error code. */
export function adminErrorKey(code: AdminErrorCode): `errors.${AdminErrorCode}` {
  return `errors.${ADMIN_ERROR_CODES.includes(code) ? code : "ADMIN_ACTION_FAILED"}`;
}
