import { SPACE_ERROR_CODES, type SpaceErrorCode } from "@/server/space";

/** Translation key (in the `errors` namespace) for a Space action error code. */
export function spaceErrorKey(code: SpaceErrorCode): `errors.${SpaceErrorCode}` {
  return `errors.${SPACE_ERROR_CODES.includes(code) ? code : "SPACE_WRITE_FAILED"}`;
}

/** Errors the forms show next to the slug field instead of at the top of the form. */
export function isSlugError(code: SpaceErrorCode): boolean {
  return code === "SPACE_SLUG_TAKEN";
}
