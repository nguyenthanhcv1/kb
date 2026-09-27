import { describe, expect, it } from "vitest";

import {
  SpaceError,
  archiveSpace,
  createSpace,
  createSpaceInputSchema,
  listSpaces,
  updateSpace,
  type SpaceSummary,
} from "./index";
import { FakeSpaceDb, type FakeSpaceRow } from "./test-support";

const now = "2026-09-01T00:00:00.000Z";

// Space/user ids must be real UUIDs: `spaceRowSchema`/`spaceSummarySchema` validate `id` and
// `createdBy` with `z.guid()`, the same as the real `spaces.id uuid` / `created_by uuid` columns.
const SPACE_1 = "00000000-0000-4000-8000-000000000001";
const SPACE_2 = "00000000-0000-4000-8000-000000000002";
const MISSING_SPACE = "00000000-0000-4000-8000-0000000000ff";
const USER_ADMIN = "10000000-0000-4000-8000-000000000001";
const USER_SUPER = "10000000-0000-4000-8000-000000000002";
const USER_EDITOR = "10000000-0000-4000-8000-000000000003";
const USER_INTERNAL = "10000000-0000-4000-8000-000000000004";
const USER_GUEST = "10000000-0000-4000-8000-000000000005";
const USER_1 = "10000000-0000-4000-8000-000000000006";

function makeSpace(overrides: Partial<FakeSpaceRow>): FakeSpaceRow {
  return {
    id: SPACE_1,
    slug: "design",
    name: "Design",
    description: null,
    icon: null,
    visibility: "restricted",
    ai_enabled: true,
    created_by: USER_ADMIN,
    created_at: now,
    updated_at: now,
    archived_at: null,
    ...overrides,
  };
}

describe("createSpaceInputSchema (validation)", () => {
  it("accepts a minimal valid input", () => {
    const parsed = createSpaceInputSchema.safeParse({ slug: "ab", name: "A" });
    expect(parsed.success).toBe(true);
  });

  it.each(["a", "a".repeat(51), "Design", "has space", "has_underscore", "trailing-"])(
    "rejects slug %p",
    (slug: string) => {
      // "trailing-" is 9 chars, valid length; it exercises the regex on a realistic near-miss
      // alongside the genuinely-invalid slugs (upper-case, spaces, underscore, too short/long).
      const parsed = createSpaceInputSchema.safeParse({ slug, name: "A" });
      if (slug === "trailing-") {
        expect(parsed.success).toBe(true);
        return;
      }
      expect(parsed.success).toBe(false);
    },
  );

  it("accepts the boundary lengths 2 and 50", () => {
    expect(createSpaceInputSchema.safeParse({ slug: "ab", name: "A" }).success).toBe(true);
    expect(createSpaceInputSchema.safeParse({ slug: "a".repeat(50), name: "A" }).success).toBe(
      true,
    );
    expect(createSpaceInputSchema.safeParse({ slug: "a".repeat(51), name: "A" }).success).toBe(
      false,
    );
  });

  it("trims name and rejects a blank one", () => {
    const parsed = createSpaceInputSchema.safeParse({ slug: "ab", name: "  Design  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.name).toBe("Design");

    expect(createSpaceInputSchema.safeParse({ slug: "ab", name: "   " }).success).toBe(false);
    expect(createSpaceInputSchema.safeParse({ slug: "ab", name: "" }).success).toBe(false);
  });

  it("allows null description/icon but rejects other falsy-ish types", () => {
    expect(
      createSpaceInputSchema.safeParse({ slug: "ab", name: "A", description: null, icon: null })
        .success,
    ).toBe(true);
    expect(
      createSpaceInputSchema.safeParse({ slug: "ab", name: "A", description: 123 }).success,
    ).toBe(false);
  });

  it("restricts visibility to restricted/internal", () => {
    expect(
      createSpaceInputSchema.safeParse({ slug: "ab", name: "A", visibility: "internal" }).success,
    ).toBe(true);
    expect(
      createSpaceInputSchema.safeParse({ slug: "ab", name: "A", visibility: "public" }).success,
    ).toBe(false);
  });

  it("requires aiEnabled to be a boolean when present", () => {
    expect(
      createSpaceInputSchema.safeParse({ slug: "ab", name: "A", aiEnabled: true }).success,
    ).toBe(true);
    expect(
      createSpaceInputSchema.safeParse({ slug: "ab", name: "A", aiEnabled: "yes" }).success,
    ).toBe(false);
  });
});

describe("listSpaces", () => {
  it("throws FORBIDDEN when signed out", async () => {
    const db = new FakeSpaceDb({ currentUserId: null });
    await expect(listSpaces(db)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("maps a row for a super admin, including fields and role", async () => {
    const space = makeSpace({ description: "desc", icon: "🎨", visibility: "internal" });
    const db = new FakeSpaceDb({
      currentUserId: USER_SUPER,
      profiles: [{ id: USER_SUPER, is_super_admin: true, is_guest: false }],
      spaces: [space],
    });

    const { spaces } = await listSpaces(db);
    expect(spaces).toEqual<SpaceSummary[]>([
      {
        id: SPACE_1,
        slug: "design",
        name: "Design",
        description: "desc",
        icon: "🎨",
        visibility: "internal",
        aiEnabled: true,
        createdBy: USER_ADMIN,
        createdAt: now,
        updatedAt: now,
        role: "admin",
      },
    ]);
  });

  it("gives an explicit member their stored role, even in a restricted Space", async () => {
    const space = makeSpace({ visibility: "restricted" });
    const db = new FakeSpaceDb({
      currentUserId: USER_EDITOR,
      profiles: [{ id: USER_EDITOR, is_super_admin: false, is_guest: false }],
      members: [{ space_id: SPACE_1, user_id: USER_EDITOR, role: "editor" }],
      spaces: [space],
    });

    const { spaces } = await listSpaces(db);
    expect(spaces).toHaveLength(1);
    expect(spaces[0]?.role).toBe("editor");
  });

  it("gives an internal user with no membership an implicit viewer role in internal Spaces", async () => {
    const space = makeSpace({ visibility: "internal" });
    const db = new FakeSpaceDb({
      currentUserId: USER_INTERNAL,
      profiles: [{ id: USER_INTERNAL, is_super_admin: false, is_guest: false }],
      spaces: [space],
    });

    const { spaces } = await listSpaces(db);
    expect(spaces).toHaveLength(1);
    expect(spaces[0]?.role).toBe("viewer");
  });

  it("hides restricted Spaces from non-members and archived Spaces from everyone", async () => {
    const restricted = makeSpace({ slug: "restricted-one", visibility: "restricted" });
    const archived = makeSpace({
      id: SPACE_2,
      slug: "archived-one",
      visibility: "internal",
      archived_at: now,
    });
    const db = new FakeSpaceDb({
      currentUserId: USER_INTERNAL,
      profiles: [{ id: USER_INTERNAL, is_super_admin: false, is_guest: false }],
      spaces: [restricted, archived],
    });

    const { spaces } = await listSpaces(db);
    expect(spaces).toEqual([]);
  });

  it("hides internal Spaces from guests unless they are an explicit member", async () => {
    const internal = makeSpace({ visibility: "internal" });
    const db = new FakeSpaceDb({
      currentUserId: USER_GUEST,
      profiles: [{ id: USER_GUEST, is_super_admin: false, is_guest: true }],
      spaces: [internal],
    });

    expect((await listSpaces(db)).spaces).toEqual([]);

    db.members.push({ space_id: SPACE_1, user_id: USER_GUEST, role: "viewer" });
    expect((await listSpaces(db)).spaces).toHaveLength(1);
  });

  it("applies the query filter case-insensitively", async () => {
    const db = new FakeSpaceDb({
      currentUserId: USER_SUPER,
      profiles: [{ id: USER_SUPER, is_super_admin: true, is_guest: false }],
      spaces: [
        makeSpace({ id: SPACE_1, slug: "design", name: "Design" }),
        makeSpace({ id: SPACE_2, slug: "eng", name: "Engineering" }),
      ],
    });

    const { spaces } = await listSpaces(db, { query: "des" });
    expect(spaces.map((s) => s.slug)).toEqual(["design"]);
  });

  it("throws VALIDATION_FAILED for a malformed query input", async () => {
    const db = new FakeSpaceDb({ currentUserId: USER_SUPER });
    await expect(listSpaces(db, { query: "" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});

describe("createSpace", () => {
  it("creates a Space and returns the caller as admin", async () => {
    const db = new FakeSpaceDb({
      currentUserId: USER_1,
      profiles: [{ id: USER_1, is_super_admin: false, is_guest: false }],
    });

    const created = await createSpace(db, { slug: "design", name: "Design" });
    expect(created.createdBy).toBe(USER_1);
    expect(created.role).toBe("admin");
    expect(created.visibility).toBe("restricted");
    expect(created.aiEnabled).toBe(true);
    expect(db.spaces).toHaveLength(1);
  });

  it("passes through optional fields", async () => {
    const db = new FakeSpaceDb({
      currentUserId: USER_1,
      profiles: [{ id: USER_1, is_super_admin: false, is_guest: false }],
    });

    const created = await createSpace(db, {
      slug: "design",
      name: "Design",
      description: "Team docs",
      icon: "🎨",
      visibility: "internal",
      aiEnabled: false,
    });
    expect(created).toMatchObject({
      description: "Team docs",
      icon: "🎨",
      visibility: "internal",
      aiEnabled: false,
    });
  });

  it("throws SPACE_SLUG_TAKEN on a duplicate slug", async () => {
    const db = new FakeSpaceDb({
      currentUserId: USER_1,
      profiles: [{ id: USER_1, is_super_admin: false, is_guest: false }],
      spaces: [makeSpace({ slug: "design" })],
    });

    await expect(createSpace(db, { slug: "design", name: "Design v2" })).rejects.toMatchObject({
      code: "SPACE_SLUG_TAKEN",
    });
  });

  it("throws FORBIDDEN for a guest (not an internal user)", async () => {
    const db = new FakeSpaceDb({
      currentUserId: USER_GUEST,
      profiles: [{ id: USER_GUEST, is_super_admin: false, is_guest: true }],
    });

    await expect(createSpace(db, { slug: "design", name: "Design" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("throws FORBIDDEN when signed out", async () => {
    const db = new FakeSpaceDb({ currentUserId: null });
    await expect(createSpace(db, { slug: "design", name: "Design" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("throws VALIDATION_FAILED for an invalid slug", async () => {
    const db = new FakeSpaceDb({ currentUserId: USER_1 });
    await expect(createSpace(db, { slug: "N", name: "Design" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});

describe("updateSpace", () => {
  function seed(role: "admin" | "editor" | "viewer" | null) {
    const space = makeSpace({ slug: "design", name: "Design" });
    const members = role && role !== "admin" ? [{ space_id: SPACE_1, user_id: USER_1, role }] : [];
    const profiles = [{ id: USER_1, is_super_admin: false, is_guest: false }];
    const db = new FakeSpaceDb({ currentUserId: USER_1, profiles, spaces: [space], members });
    if (role === "admin") db.members.push({ space_id: SPACE_1, user_id: USER_1, role: "admin" });
    return db;
  }

  it("updates fields for an admin and returns the fresh row with role admin", async () => {
    const db = seed("admin");
    const updated = await updateSpace(db, { id: SPACE_1, name: "Design Team" });
    expect(updated.name).toBe("Design Team");
    expect(updated.role).toBe("admin");
  });

  it("throws FORBIDDEN for an editor (visible but not admin)", async () => {
    const db = seed("editor");
    await expect(updateSpace(db, { id: SPACE_1, name: "x" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("throws FORBIDDEN for a viewer calling with no changed fields (regression: must not bypass the admin check)", async () => {
    const db = seed("viewer");
    await expect(updateSpace(db, { id: SPACE_1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("succeeds for an admin calling with no changed fields (still runs the authorization check)", async () => {
    const db = seed("admin");
    const before = db.spaces[0]!.updated_at;
    const updated = await updateSpace(db, { id: SPACE_1 });
    expect(updated.name).toBe("Design");
    expect(updated.role).toBe("admin");
    expect(db.spaces[0]!.updated_at).not.toBe(before);
  });

  it("throws SPACE_NOT_FOUND for a Space the caller cannot see at all", async () => {
    const db = seed(null);
    await expect(updateSpace(db, { id: SPACE_1, name: "x" })).rejects.toMatchObject({
      code: "SPACE_NOT_FOUND",
    });
  });

  it("throws SPACE_NOT_FOUND, not FORBIDDEN, for an id that never existed", async () => {
    const db = seed("admin");
    await expect(updateSpace(db, { id: MISSING_SPACE, name: "x" })).rejects.toMatchObject({
      code: "SPACE_NOT_FOUND",
    });
  });

  it("throws SPACE_SLUG_TAKEN when renaming into a slug used by another Space", async () => {
    const db = seed("admin");
    db.spaces.push(makeSpace({ id: SPACE_2, slug: "taken", name: "Other" }));
    await expect(updateSpace(db, { id: SPACE_1, slug: "taken" })).rejects.toMatchObject({
      code: "SPACE_SLUG_TAKEN",
    });
  });

  it("throws VALIDATION_FAILED for a malformed id", async () => {
    const db = seed("admin");
    await expect(updateSpace(db, { id: "not-a-uuid" as never })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});

describe("archiveSpace", () => {
  function seed(role: "admin" | "viewer" | null) {
    const space = makeSpace({});
    const members =
      role === "viewer" ? [{ space_id: SPACE_1, user_id: USER_1, role: "viewer" as const }] : [];
    const profiles = [{ id: USER_1, is_super_admin: false, is_guest: false }];
    const db = new FakeSpaceDb({ currentUserId: USER_1, profiles, spaces: [space], members });
    if (role === "admin") db.members.push({ space_id: SPACE_1, user_id: USER_1, role: "admin" });
    return db;
  }

  it("archives the Space for an admin", async () => {
    const db = seed("admin");
    await archiveSpace(db, { id: SPACE_1 });
    expect(db.spaces[0]!.archived_at).not.toBeNull();
  });

  it("is idempotent: a second archive call throws SPACE_NOT_FOUND, not a write error", async () => {
    const db = seed("admin");
    await archiveSpace(db, { id: SPACE_1 });
    await expect(archiveSpace(db, { id: SPACE_1 })).rejects.toMatchObject({
      code: "SPACE_NOT_FOUND",
    });
  });

  it("throws FORBIDDEN for a non-admin member who can see the Space", async () => {
    const db = seed("viewer");
    await expect(archiveSpace(db, { id: SPACE_1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws SPACE_NOT_FOUND for a Space the caller cannot see", async () => {
    const db = seed(null);
    await expect(archiveSpace(db, { id: SPACE_1 })).rejects.toMatchObject({
      code: "SPACE_NOT_FOUND",
    });
  });

  it("throws FORBIDDEN when signed out", async () => {
    const db = seed("admin");
    db.currentUserId = null;
    await expect(archiveSpace(db, { id: SPACE_1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("SpaceError", () => {
  it("carries its code as the error name-independent discriminant", () => {
    const error = new SpaceError("SPACE_NOT_FOUND");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("SPACE_NOT_FOUND");
    expect(error.name).toBe("SpaceError");
  });
});
