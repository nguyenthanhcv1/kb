/** Failure reasons kb-collab sends when it refuses a connection (apps/collab/src/errors.ts). */
export type CollabFailure = "outdated" | "forbidden";

export type CollabStatus =
  /** Opening the connection, or waiting for the first sync. */
  | "connecting"
  /** Connected and everything typed is stored on the server. */
  | "saved"
  /** Connected; local changes are waiting for the server to acknowledge them. */
  | "saving"
  /** Connection lost: typing continues locally and syncs on reconnect. */
  | "offline"
  /** The app was updated (`CLIENT_OUTDATED`): reload to keep editing. */
  | "outdated"
  /** The server refuses this page (`FORBIDDEN`, `ORIGIN_NOT_ALLOWED`). */
  | "forbidden";

export type CollabSnapshot = {
  connected: boolean;
  /** The first sync with the server finished at some point. */
  synced: boolean;
  unsyncedChanges: number;
  failure: CollabFailure | null;
  /** The server accepted the connection read-only (viewer): it refuses every local change. */
  readOnly?: boolean;
};

/** Collapses provider events into the one status the indicator shows. */
export function deriveCollabStatus(s: CollabSnapshot): CollabStatus {
  if (s.failure) return s.failure;
  if (!s.connected) return s.synced ? "offline" : "connecting";
  if (!s.synced) return "connecting";
  // A read-only connection never gets its changes acknowledged: "saving" would never end.
  return s.unsyncedChanges > 0 && !s.readOnly ? "saving" : "saved";
}

/** Maps the `reason` of `authenticationFailed` to a terminal failure, or null when retryable. */
export function failureFromReason(reason: string): CollabFailure | null {
  if (reason === "CLIENT_OUTDATED") return "outdated";
  if (reason === "FORBIDDEN" || reason === "ORIGIN_NOT_ALLOWED") return "forbidden";
  return null;
}

/** Whether the access token should be re-sent to the open connection (`expiresAt`: epoch ms). */
export function tokenNeedsRefresh(expiresAt: number, now: number, marginMs = 120_000): boolean {
  return expiresAt - now <= marginMs;
}
