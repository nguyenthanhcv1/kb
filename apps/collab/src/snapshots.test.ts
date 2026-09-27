import { describe, expect, it } from "vitest";

import { SnapshotTracker } from "./snapshots";

describe("SnapshotTracker", () => {
  it("tracks stores not covered by a version until the document unloads", () => {
    const tracker = new SnapshotTracker();
    tracker.stored("page:a", "stored", "u1");
    tracker.stored("page:a", "stored", "u2");
    expect(tracker.take("page:a")).toEqual({ editorId: "u2" });
    expect(tracker.take("page:a")).toBeUndefined();
  });

  it("forgets a document once a version contains its state", () => {
    const tracker = new SnapshotTracker();
    tracker.stored("page:a", "stored", "u1");
    tracker.stored("page:a", "snapshotted", "u1");
    expect(tracker.take("page:a")).toBeUndefined();

    tracker.stored("page:b", "stored", null);
    tracker.snapshotted("page:b");
    expect(tracker.take("page:b")).toBeUndefined();
  });

  it("keeps documents apart", () => {
    const tracker = new SnapshotTracker();
    tracker.stored("page:a", "stored", "u1");
    expect(tracker.take("page:b")).toBeUndefined();
    expect(tracker.take("page:a")).toEqual({ editorId: "u1" });
  });
});
