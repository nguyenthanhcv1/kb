import type { DocumentStore } from "./db";
import type { Logger } from "./logger";

/**
 * Nightly retention of page versions (T6.1a, docs/PLAN.md §3.2): calls
 * `app.prune_page_versions()` every day at 02:30 Asia/Ho_Chi_Minh (19:30 UTC — Vietnam has no
 * daylight saving). Runs here rather than in pg_cron: pg_cron jobs only run in one database, which
 * breaks restoring a backup into another one. The function is idempotent, so several collab
 * instances running it is harmless.
 */
export const RETENTION_UTC_HOUR = 19;
export const RETENTION_UTC_MINUTE = 30;

/** Next run strictly after `now`. */
export function nextRetentionRun(now: Date): Date {
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      RETENTION_UTC_HOUR,
      RETENTION_UTC_MINUTE,
    ),
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/** Starts the daily schedule; returns a function that stops it. Timers never keep the process alive. */
export function startVersionRetention({
  store,
  logger,
  now = () => new Date(),
}: {
  store: Pick<DocumentStore, "prunePageVersions">;
  logger: Logger;
  now?: () => Date;
}): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const schedule = () => {
    if (stopped) return;
    const at = nextRetentionRun(now());
    timer = setTimeout(run, at.getTime() - now().getTime());
    timer.unref?.();
  };

  const run = async () => {
    try {
      const deleted = await store.prunePageVersions();
      logger.info({ deleted }, "page version retention done");
    } catch (error) {
      logger.error({ err: error }, "page version retention failed");
    }
    schedule();
  };

  schedule();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
