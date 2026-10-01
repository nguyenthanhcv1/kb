import { MEMBER_ERROR_CODES, type MemberErrorCode } from "@/server/members";

/** Translation key (in the `errors` namespace) for a members/invitations action error code. */
export function memberErrorKey(code: MemberErrorCode): `errors.${MemberErrorCode}` {
  return `errors.${MEMBER_ERROR_CODES.includes(code) ? code : "MEMBER_ACTION_FAILED"}`;
}
