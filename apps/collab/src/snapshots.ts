/**
 * Page version snapshot policy of kb-collab (docs/PLAN.md §3.6, task T6.1b):
 *
 * - `auto` (a): with a store of real changes, when the last `auto` version of the page is older
 *   than {@link AUTO_SNAPSHOT_INTERVAL_MS} — checked in the store transaction (db.ts), so it holds
 *   across restarts and instances. Editing for 30 minutes gives about 3 versions.
 * - `auto` (b): when the last client leaves (the document unloads) and changes stored since the
 *   last version are not in any version yet.
 * - `manual`: "Save version" in the UI → kb-web → `POST /internal/documents/:id/versions`
 *   (internal-api.ts), optionally named (`label`).
 * - `pre_restore` / `restore`: the restore flow (T6.3a).
 */
export const AUTO_SNAPSHOT_INTERVAL_MS = 10 * 60_000;

/** Longest name of a manual version (page_versions.label check). */
export const VERSION_LABEL_MAX_LENGTH = 200;

/**
 * Documents (by name) with stored changes that no version contains yet, with their last editor
 * (author of the version written on unload). In memory only: after a restart the next store
 * re-evaluates rule (a).
 */
export class SnapshotTracker {
  readonly #pending = new Map<string, string | null>();

  /** After a store: `snapshotted` clears the document, a plain store marks it. */
  stored(documentName: string, outcome: "stored" | "snapshotted", editorId: string | null): void {
    if (outcome === "snapshotted") this.#pending.delete(documentName);
    else this.#pending.set(documentName, editorId);
  }

  /** A version of the current state was written some other way (manual version). */
  snapshotted(documentName: string): void {
    this.#pending.delete(documentName);
  }

  /** Removes and returns the pending entry (on unload); undefined = nothing to snapshot. */
  take(documentName: string): { editorId: string | null } | undefined {
    if (!this.#pending.has(documentName)) return undefined;
    const editorId = this.#pending.get(documentName) ?? null;
    this.#pending.delete(documentName);
    return { editorId };
  }
}
