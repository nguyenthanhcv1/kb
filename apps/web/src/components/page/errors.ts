import { PAGE_ERROR_CODES, type PageErrorCode } from "@/server/pages";

/** Translation key (in the `errors` namespace) for a page action error code. */
export function pageErrorKey(code: PageErrorCode): `errors.${PageErrorCode}` {
  return `errors.${PAGE_ERROR_CODES.includes(code) ? code : "PAGE_ACTION_FAILED"}`;
}
