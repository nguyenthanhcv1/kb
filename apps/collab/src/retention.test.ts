import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import { nextRetentionRun, startVersionRetention } from "./retention";

const logger = pino({ level: "silent" });

describe("nextRetentionRun", () => {
  it("runs at 02:30 Asia/Ho_Chi_Minh (19:30 UTC) the same day when still ahead", () => {
    expect(nextRetentionRun(new Date("2026-09-27T10:00:00Z")).toISOString()).toBe(
      "2026-09-27T19:30:00.000Z",
    );
  });

  it("moves to the next day once 19:30 UTC has passed (or is now)", () => {
    expect(nextRetentionRun(new Date("2026-09-27T19:30:00Z")).toISOString()).toBe(
      "2026-09-28T19:30:00.000Z",
    );
    expect(nextRetentionRun(new Date("2026-12-31T23:00:00Z")).toISOString()).toBe(
      "2027-01-01T19:30:00.000Z",
    );
  });
});

describe("startVersionRetention", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("prunes once a day and keeps going after a failure", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-27T19:00:00Z") });
    const prunePageVersions = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValue(3);
    const stop = startVersionRetention({
      store: { prunePageVersions },
      logger,
      now: () => new Date(),
    });

    await vi.advanceTimersByTimeAsync(29 * 60_000);
    expect(prunePageVersions).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(prunePageVersions).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(prunePageVersions).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(48 * 60 * 60_000);
    expect(prunePageVersions).toHaveBeenCalledTimes(2);
  });
});
