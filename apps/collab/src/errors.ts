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

/**
 * Codes of the internal API (`POST /internal/documents/:id/replace` T3.7, `…/versions` T6.1b, `…/versions/:versionId/restore` T6.3a) in `{ code }` JSON
 * bodies. Only kb-web reads them; `apps/web/src/server/collab` maps them to user-facing codes
 * (`errors.<CODE>`) before anything reaches the UI.
 */
export const INTERNAL_API_ERROR_CODES = [
  /** Missing/invalid HMAC headers, expired timestamp or replayed nonce. */
  "UNAUTHORIZED",
  /** Unknown route, or the request came through the public proxy (see internal-api.ts). */
  "NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  /** COLLAB_INTERNAL_SECRET is not configured on kb-collab. */
  "INTERNAL_API_DISABLED",
  "PAYLOAD_TOO_LARGE",
  /** Bad page id, bad JSON, or content that does not fit the shared editor schema. */
  "VALIDATION_FAILED",
  /** No `page_documents` row for the page (never created, or purged). */
  "PAGE_NOT_FOUND",
  /** Stored document written by a newer EDITOR_SCHEMA_VERSION than this server. */
  "DOCUMENT_SCHEMA_TOO_NEW",
  /** Unexpected failure while loading or changing the document. */
  "REPLACE_FAILED",
  /** The actor may not save versions of this page (viewer). */
  "FORBIDDEN",
  /** Unexpected failure while saving a page version. */
  "VERSION_FAILED",
  /** The version to restore does not exist (or belongs to another page). */
  "VERSION_NOT_FOUND",
  /** Unexpected failure in the restore flow (pre_restore → replace → restore). */
  "RESTORE_FAILED",
] as const;
export type InternalApiErrorCode = (typeof INTERNAL_API_ERROR_CODES)[number];

/** Thrown by the Database `fetch` hook so callers can tell "no such page" from other failures. */
export class DocumentLoadError extends Error {
  readonly code: "PAGE_NOT_FOUND" | "DOCUMENT_SCHEMA_TOO_NEW";

  constructor(code: DocumentLoadError["code"], message: string) {
    super(message);
    this.name = "DocumentLoadError";
    this.code = code;
  }
}
