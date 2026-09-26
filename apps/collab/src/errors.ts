/**
 * Reasons kb-collab sends when it refuses a connection (`authenticationFailed.reason` on the
 * client). Codes, not sentences: the web client translates them via `errors.<CODE>`.
 */
export const COLLAB_ERROR_CODES = [
  /** Missing, malformed or expired access token. */
  "UNAUTHORIZED",
  /** Valid user without access to the page (or the page does not exist / is in the trash). */
  "FORBIDDEN",
  /** The client's EDITOR_SCHEMA_VERSION differs from the server's: reload the app. */
  "CLIENT_OUTDATED",
  /** `Origin` header not in ALLOWED_ORIGINS. */
  "ORIGIN_NOT_ALLOWED",
] as const;
export type CollabErrorCode = (typeof COLLAB_ERROR_CODES)[number];

/** Hocuspocus forwards `reason` of the thrown value to the client. */
export class CollabAuthError extends Error {
  readonly reason: CollabErrorCode;

  constructor(reason: CollabErrorCode) {
    super(reason);
    this.name = "CollabAuthError";
    this.reason = reason;
  }
}
