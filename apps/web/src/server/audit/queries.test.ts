import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const { loadAuditPeople, referencedUserIds } = await import("./queries");

const A = "7c1e0000-0000-4000-8000-000000000003";
const B = "7c1e0000-0000-4000-8000-000000000004";

describe("referencedUserIds", () => {
  it("collects distinct, valid metadata.user_id values", () => {
    expect(
      referencedUserIds([
        { metadata: { user_id: A } },
        { metadata: { user_id: A.toUpperCase() } },
        { metadata: { user_id: B } },
        { metadata: { user_id: "not-a-uuid" } },
        { metadata: { email: "x@y.z" } },
      ]),
    ).toEqual([A, B]);
  });
});

describe("loadAuditPeople", () => {
  function db(result: { data: unknown; error: { message: string } | null }) {
    const inFn = vi.fn().mockResolvedValue(result);
    const select = vi.fn(() => ({ in: inFn }));
    return { from: vi.fn(() => ({ select })), select, inFn };
  }

  it("skips the query without ids", async () => {
    const fake = db({ data: [], error: null });
    await expect(loadAuditPeople(fake, [])).resolves.toEqual({});
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("maps visible profiles by id", async () => {
    const fake = db({ data: [{ id: A, email: "a@x.vn", full_name: "An" }], error: null });
    await expect(loadAuditPeople(fake, [A, B])).resolves.toEqual({
      [A]: { id: A, email: "a@x.vn", fullName: "An" },
    });
    expect(fake.from).toHaveBeenCalledWith("profiles");
    expect(fake.inFn).toHaveBeenCalledWith("id", [A, B]);
  });

  it("returns no names on a lookup error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = db({ data: null, error: { message: "boom" } });
    await expect(loadAuditPeople(fake, [A])).resolves.toEqual({});
  });
});
