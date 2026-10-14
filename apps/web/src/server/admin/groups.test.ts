import { describe, expect, it } from "vitest";

import {
  addGroupMembers,
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  removeGroupMember,
  searchGroupCandidates,
  updateGroup,
} from "./groups";
import { AdminError, type AdminDb, type AdminQuery } from "./index";

const SUPER = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const GROUP = "7a0f0000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000003";
const SPACE = "00000000-0000-4000-8000-000000000001";

type Result = { data: unknown; error: { code?: string; message: string } | null };

/** Recording stand-in for the Supabase client (SQL behaviour is covered by pgTAP). */
class FakeDb implements AdminDb {
  calls: { fn: string; args?: unknown }[] = [];
  results: Record<string, Result> = {};

  constructor(private readonly userId: string = SUPER) {}

  auth = { getUser: async () => ({ data: { user: { id: this.userId } } }) };

  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<Result> {
    this.calls.push({ fn, args });
    return Promise.resolve(this.results[fn] ?? { data: [], error: null });
  }

  from(): AdminQuery {
    const profile = {
      id: this.userId,
      email: "super@corp.example",
      locale: "en",
      is_super_admin: this.userId === SUPER,
      deactivated_at: null,
    };
    const query = {
      select: () => query,
      eq: () => query,
      single: () => Promise.resolve({ data: profile, error: null }),
    };
    return query as unknown as AdminQuery;
  }
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy(
    (error) => error instanceof AdminError && error.code === code,
  );
}

const groupRow = {
  id: GROUP,
  name: "KAS",
  description: null,
  member_count: 2,
  space_count: 1,
  created_at: "2026-10-12T02:00:00+00:00",
};

describe("groups contract", () => {
  it("is super admin only, before touching the data", async () => {
    const db = new FakeDb(OTHER);
    await expectCode(listGroups(db), "FORBIDDEN");
    await expectCode(createGroup(db, { name: "KAS" }), "FORBIDDEN");
    expect(db.calls).toEqual([]);
  });

  it("lists groups", async () => {
    const db = new FakeDb();
    db.results.admin_list_groups = { data: [groupRow], error: null };
    await expect(listGroups(db)).resolves.toEqual({
      groups: [
        {
          id: GROUP,
          name: "KAS",
          description: null,
          memberCount: 2,
          spaceCount: 1,
          createdAt: "2026-10-12T02:00:00+00:00",
        },
      ],
    });
  });

  it("gets a group with its members and Spaces, and reports an unknown one", async () => {
    const db = new FakeDb();
    db.results.admin_list_group_members = {
      data: [
        {
          user_id: USER,
          email: "an@corp.example",
          full_name: "Nguyễn An",
          avatar_url: null,
          added_at: "2026-10-12T03:00:00+00:00",
        },
      ],
      error: null,
    };
    db.results.admin_list_group_spaces = {
      data: [{ space_id: SPACE, slug: "sales", name: "Sales", role: "editor" }],
      error: null,
    };
    db.results.admin_list_groups = { data: [groupRow], error: null };
    const { group, members, spaces } = await getGroup(db, { groupId: GROUP });
    expect(spaces).toEqual([{ spaceId: SPACE, slug: "sales", name: "Sales", role: "editor" }]);
    expect(db.calls).toContainEqual({ fn: "admin_list_group_spaces", args: { p_group_id: GROUP } });
    expect(group.memberCount).toBe(2);
    expect(members).toEqual([
      {
        userId: USER,
        email: "an@corp.example",
        fullName: "Nguyễn An",
        avatarUrl: null,
        addedAt: "2026-10-12T03:00:00+00:00",
      },
    ]);

    db.results.admin_list_groups = { data: [], error: null };
    await expectCode(getGroup(db, { groupId: GROUP }), "GROUP_NOT_FOUND");
  });

  it("validates input before calling the database", async () => {
    const db = new FakeDb();
    await expectCode(createGroup(db, { name: "   " }), "VALIDATION_FAILED");
    await expectCode(createGroup(db, { name: "x".repeat(81) }), "VALIDATION_FAILED");
    await expectCode(
      createGroup(db, { name: "ok", description: "x".repeat(501) }),
      "VALIDATION_FAILED",
    );
    await expectCode(addGroupMembers(db, { groupId: GROUP, userIds: [] }), "VALIDATION_FAILED");
    await expectCode(deleteGroup(db, { groupId: "nope" }), "VALIDATION_FAILED");
    await expectCode(
      searchGroupCandidates(db, { groupId: GROUP, query: "  " }),
      "VALIDATION_FAILED",
    );
    expect(db.calls).toEqual([]);
  });

  it("creates, trimming the name and dropping an empty description", async () => {
    const db = new FakeDb();
    db.results.admin_create_group = { data: GROUP, error: null };
    await expect(createGroup(db, { name: "  KAS ", description: "  " })).resolves.toEqual({
      groupId: GROUP,
    });
    expect(db.calls).toEqual([
      { fn: "admin_create_group", args: { p_name: "KAS", p_description: null } },
    ]);
  });

  it("maps database errors to codes", async () => {
    const db = new FakeDb();
    db.results.admin_create_group = {
      data: null,
      error: { code: "23505", message: "GROUP_NAME_TAKEN" },
    };
    await expectCode(createGroup(db, { name: "KAS" }), "GROUP_NAME_TAKEN");
    db.results.admin_add_group_members = {
      data: null,
      error: { code: "23514", message: "GROUP_MEMBER_NOT_INTERNAL" },
    };
    await expectCode(
      addGroupMembers(db, { groupId: GROUP, userIds: [USER] }),
      "GROUP_MEMBER_NOT_INTERNAL",
    );
    db.results.admin_update_group = {
      data: null,
      error: { code: "P0002", message: "GROUP_NOT_FOUND" },
    };
    await expectCode(updateGroup(db, { groupId: GROUP, name: "X" }), "GROUP_NOT_FOUND");
  });

  it("updates, adds (once per person), removes, deletes and searches", async () => {
    const db = new FakeDb();
    db.results.admin_add_group_members = { data: 1, error: null };
    db.results.admin_delete_group = { data: 2, error: null };
    db.results.admin_search_group_candidates = {
      data: [{ user_id: USER, email: "an@corp.example", full_name: null, avatar_url: null }],
      error: null,
    };

    await updateGroup(db, { groupId: GROUP, name: " KAS team ", description: "Sales" });
    await expect(addGroupMembers(db, { groupId: GROUP, userIds: [USER, USER] })).resolves.toEqual({
      added: 1,
    });
    await removeGroupMember(db, { groupId: GROUP, userId: USER });
    await expect(deleteGroup(db, { groupId: GROUP })).resolves.toEqual({ removedMembers: 2 });
    await expect(searchGroupCandidates(db, { groupId: GROUP, query: " nguyen " })).resolves.toEqual(
      {
        candidates: [{ userId: USER, email: "an@corp.example", fullName: null, avatarUrl: null }],
      },
    );

    expect(db.calls).toEqual([
      {
        fn: "admin_update_group",
        args: { p_group_id: GROUP, p_name: "KAS team", p_description: "Sales" },
      },
      { fn: "admin_add_group_members", args: { p_group_id: GROUP, p_user_ids: [USER] } },
      { fn: "admin_remove_group_member", args: { p_group_id: GROUP, p_user_id: USER } },
      { fn: "admin_delete_group", args: { p_group_id: GROUP } },
      {
        fn: "admin_search_group_candidates",
        args: { p_group_id: GROUP, p_query: "nguyen", p_limit: 10 },
      },
    ]);
  });
});
