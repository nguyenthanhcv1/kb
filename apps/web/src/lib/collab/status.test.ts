import { describe, expect, it } from "vitest";

import { deriveCollabStatus, failureFromReason, tokenNeedsRefresh } from "./status";

const base = { connected: true, synced: true, unsyncedChanges: 0, failure: null } as const;

describe("deriveCollabStatus", () => {
  it("is connecting until the first sync", () => {
    expect(deriveCollabStatus({ ...base, connected: false, synced: false })).toBe("connecting");
    expect(deriveCollabStatus({ ...base, synced: false })).toBe("connecting");
  });
  it("is saved / saving while connected", () => {
    expect(deriveCollabStatus(base)).toBe("saved");
    expect(deriveCollabStatus({ ...base, unsyncedChanges: 2 })).toBe("saving");
  });
  it("is offline after a sync when the connection drops", () => {
    expect(deriveCollabStatus({ ...base, connected: false, unsyncedChanges: 3 })).toBe("offline");
  });
  it("a failure wins over everything", () => {
    expect(deriveCollabStatus({ ...base, failure: "outdated" })).toBe("outdated");
  });
});

describe("failureFromReason", () => {
  it("maps terminal reasons only", () => {
    expect(failureFromReason("CLIENT_OUTDATED")).toBe("outdated");
    expect(failureFromReason("ORIGIN_NOT_ALLOWED")).toBe("forbidden");
    expect(failureFromReason("UNAUTHORIZED")).toBeNull();
  });
});

describe("tokenNeedsRefresh", () => {
  it("refreshes within the margin", () => {
    expect(tokenNeedsRefresh(1_000_000, 1_000_000 - 60_000)).toBe(true);
    expect(tokenNeedsRefresh(1_000_000, 1_000_000 - 600_000)).toBe(false);
  });
});
