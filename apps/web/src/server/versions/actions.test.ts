import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const restorePageVersion = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

vi.mock("@/server/collab", () => {
  class CollabError extends Error {
    constructor(
      readonly code: string,
      readonly reason: string,
    ) {
      super(`${code} (${reason})`);
    }
  }
  return { CollabError, restorePageVersion };
});

const { restorePageVersionAction } = await import("./actions");
const { CollabError } = await import("@/server/collab");

const pageId = "7b0c2a4e-1f5d-4c3b-9a8e-2d6f1b3c5a7e";
const versionId = "3f1d2a4e-1f5d-4c3b-9a8e-2d6f1b3c5a7e";

beforeEach(() => {
  getUser
    .mockReset()
    .mockResolvedValue({ data: { user: { id: "9c2e0000-0000-4000-8000-000000000001" } } });
  restorePageVersion.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("restorePageVersionAction", () => {
  it("restores on behalf of the signed-in user", async () => {
    restorePageVersion.mockResolvedValue({
      versionNo: 13,
      restoredFromVersionNo: 4,
      preRestoreVersionNo: 12,
      connections: 2,
    });
    const result = await restorePageVersionAction({ pageId, versionId });
    expect(restorePageVersion).toHaveBeenCalledWith({
      pageId,
      versionId,
      actorId: "9c2e0000-0000-4000-8000-000000000001",
    });
    expect(result).toEqual({
      ok: true,
      data: { versionNo: 13, restoredFromVersionNo: 4, preRestoreVersionNo: 12 },
    });
  });

  it("refuses signed-out callers without calling kb-collab", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await restorePageVersionAction({ pageId, versionId })).toEqual({
      ok: false,
      code: "UNAUTHORIZED",
    });
    expect(restorePageVersion).not.toHaveBeenCalled();
  });

  it("rejects malformed ids", async () => {
    expect(await restorePageVersionAction({ pageId: "x", versionId })).toEqual({
      ok: false,
      code: "VALIDATION_FAILED",
    });
  });

  it("returns the user-facing code of a collab refusal (viewer → FORBIDDEN)", async () => {
    restorePageVersion.mockRejectedValue(new CollabError("FORBIDDEN", "FORBIDDEN"));
    expect(await restorePageVersionAction({ pageId, versionId })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  it("maps unexpected failures to PAGE_ACTION_FAILED", async () => {
    restorePageVersion.mockRejectedValue(new Error("boom"));
    expect(await restorePageVersionAction({ pageId, versionId })).toEqual({
      ok: false,
      code: "PAGE_ACTION_FAILED",
    });
  });
});
