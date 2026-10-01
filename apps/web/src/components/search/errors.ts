import { SEARCH_ERROR_CODES, type SearchErrorCode } from "@/server/search";

/** Narrows a code received from the API to a known one (`errors.<CODE>`), else `SEARCH_FAILED`. */
export function searchErrorCode(code: string): SearchErrorCode {
  return (SEARCH_ERROR_CODES as readonly string[]).includes(code)
    ? (code as SearchErrorCode)
    : "SEARCH_FAILED";
}
