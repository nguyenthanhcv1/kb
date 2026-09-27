import { describe, expect, it, vi } from "vitest";

import {
  AdminError,
  addAccessEntries,
  isPublicEmailDomain,
  listAccessEntries,
  listUsers,
  parseAccessEntries,
  previewAccessRemoval,
  removeAccessEntries,
  sendTestEmail,
  setUserDeactivated,
  setUserSuperAdmin,
  type AdminDb,
  type AdminQuery,
} from "./index";

const SUPER = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const ENTRY_DOMAIN = "40000000-0000-4000-8000-000000000001";
const ENTRY_SELF = "40000000-0000-4000-8000-000000000002";

type Result = { data: unknown; error: { code?: string; message: string } | null };

interface Profile {
  id: string;
  email: string;
  locale: "vi" | "en";
  is_super_admin: boolean;
  deactivated_at: string | null;
}

/**
 * Recording stand-in for the Supabase client: the SQL behaviour (RLS, triggers, admin_* functions)
 * is covered by pgTAP (`supabase/tests/access_admin.test.sql`) and the PostgREST integration test;
 * here only the TypeScript logic around it is exercised.
 */
class FakeAdminDb implements AdminDb {
  calls: { op: string; args?: unknown }[] = [];
  rpcResults: Record<string, Result | ((args: Record<string, unknown>) => Result)> = {};
  upsertResult: Result = { data: [], error: null };
  deleteResult: Result = { data: [], error: null };

  constructor(
    private readonly profiles: Profile[],
    public userId: string | null = SUPER,
  ) {}

  auth = {
    getUser: async () => ({ data: { user: this.userId ? { id: this.userId } : null } }),
  };

  rpc(fn: string, args: Record<string, unknown> = {}): PromiseLike<Result> {
    this.calls.push({ op: `rpc:${fn}`, args });
    const result = this.rpcResults[fn];
    const value =
      typeof result === "function" ? result(args) : (result ?? { data: [], error: null });
    return Promise.resolve(value);
  }

  from(table: "access_allowlist" | "profiles"): AdminQuery {
    let mode: "select" | "upsert" | "delete" = "select";
    const filters: Record<string, unknown> = {};
    const query: AdminQuery = {
      select: () => query,
      eq: (column, value) => {
        filters[column] = value;
        return query;
      },
      in: (column, values) => {
        filters[column] = values;
        return query;
      },
      upsert: (rows, options) => {
        mode = "upsert";
        this.calls.push({ op: `upsert:${table}`, args: { rows, options } });
        return query;
      },
      delete: () => {
        mode = "delete";
        return query;
      },
      single: () => {
        const profile = this.profiles.find((p) => p.id === filters.id);
        return Promise.resolve(
          profile ? { data: profile, error: null } : { data: null, error: { message: "none" } },
        );
      },
      then: (onfulfilled, onrejected) => {
        let result: Result = { data: [], error: null };
        if (mode === "upsert") result = this.upsertResult;
        if (mode === "delete") {
          this.calls.push({ op: `delete:${table}`, args: filters });
          result = this.deleteResult;
        }
        return Promise.resolve(result).then(onfulfilled, onrejected);
      },
    };
    return query;
  }
}

const profiles: Profile[] = [
  {
    id: SUPER,
    email: "Super@Corp.example",
    locale: "en",
    is_super_admin: true,
    deactivated_at: null,
  },
  {
    id: OTHER,
    email: "an@corp.example",
    locale: "vi",
    is_super_admin: false,
    deactivated_at: null,
  },
];

function entryRow(id: string, kind: "email" | "domain", value: string, userCount = 0) {
  return {
    id,
    kind,
    value,
    note: null,
    created_by: SUPER,
    created_by_email: "super@corp.example",
    created_at: "2026-09-27T00:00:00+00:00",
    user_count: userCount,
  };
}

function userRow(id: string, email: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    email,
    full_name: null,
    avatar_url: null,
    locale: "vi",
    is_guest: false,
    is_super_admin: false,
    deactivated_at: null,
    created_at: "2026-09-01T00:00:00+00:00",
    last_sign_in_at: null,
    space_count: 0,
    access: "allowlist",
    total_count: 1,
    ...extra,
  };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy(
    (error) => error instanceof AdminError && error.code === code,
  );
}

describe("parseAccessEntries", () => {
  it("splits on new lines, commas, semicolons and spaces, and detects the kind", () => {
    const parsed = parseAccessEntries(
      "An <An@Ahamove.com>; ahamove.com,\n@Partner.vn  mailto:b@x.io",
    );
    expect(parsed.map(({ kind, value, status }) => ({ kind, value, status }))).toEqual([
      { kind: "email", value: "an@ahamove.com", status: "valid" },
      { kind: "domain", value: "ahamove.com", status: "valid" },
      { kind: "domain", value: "partner.vn", status: "valid" },
      { kind: "email", value: "b@x.io", status: "valid" },
    ]);
    expect(parsed[0]?.raw).toBe("An@Ahamove.com");
  });

  it("marks invalid tokens and duplicates within the input", () => {
    const parsed = parseAccessEntries("nope, a@b, a@@b.com, x@y.com X@Y.com, -bad-.com, x@y.com");
    expect(parsed.map((entry) => entry.status)).toEqual([
      "invalid",
      "invalid",
      "invalid",
      "valid",
      "duplicate",
      "invalid",
      "duplicate",
    ]);
  });

  it("flags public email domains only for domain entries", () => {
    const [domain, email] = parseAccessEntries("Gmail.com an@gmail.com");
    expect(domain).toMatchObject({ kind: "domain", value: "gmail.com", publicDomain: true });
    expect(email).toMatchObject({ kind: "email", publicDomain: false });
    expect(isPublicEmailDomain(" YAHOO.com ")).toBe(true);
    expect(isPublicEmailDomain("ahamove.com")).toBe(false);
  });

  it("can force a kind", () => {
    expect(parseAccessEntries("ahamove.com an@x.com", "email").map((e) => e.status)).toEqual([
      "invalid",
      "valid",
    ]);
    expect(parseAccessEntries("ahamove.com an@x.com", "domain").map((e) => e.status)).toEqual([
      "valid",
      "invalid",
    ]);
  });

  it("returns nothing for blank input", () => {
    expect(parseAccessEntries(" \n , ; ")).toEqual([]);
  });
});

describe("super admin gate", () => {
  it("rejects signed-out callers and non super admins before touching the data", async () => {
    await expectCode(listAccessEntries(new FakeAdminDb(profiles, null)), "FORBIDDEN");
    const db = new FakeAdminDb(profiles, OTHER);
    await expectCode(listUsers(db), "FORBIDDEN");
    await expectCode(addAccessEntries(db, { input: "a@b.com" }), "FORBIDDEN");
    expect(db.calls).toEqual([]);
  });

  it("rejects a deactivated super admin", async () => {
    const db = new FakeAdminDb(
      [{ ...profiles[0]!, deactivated_at: "2026-09-01T00:00:00+00:00" }],
      SUPER,
    );
    await expectCode(listAccessEntries(db), "FORBIDDEN");
  });

  it("maps DB error messages to codes", async () => {
    const db = new FakeAdminDb(profiles);
    db.rpcResults.admin_list_access_entries = {
      data: null,
      error: { code: "42501", message: "FORBIDDEN" },
    };
    await expectCode(listAccessEntries(db), "FORBIDDEN");
    db.rpcResults.admin_list_access_entries = {
      data: null,
      error: { code: "XX000", message: "boom" },
    };
    await expectCode(listAccessEntries(db), "ADMIN_ACTION_FAILED");
  });
});

describe("listAccessEntries", () => {
  it("maps rows and flags the caller's own email entry and public domains", async () => {
    const db = new FakeAdminDb(profiles);
    db.rpcResults.admin_list_access_entries = {
      data: [
        entryRow(ENTRY_DOMAIN, "domain", "gmail.com", 3),
        entryRow(ENTRY_SELF, "email", "super@corp.example", 1),
      ],
      error: null,
    };
    const { entries } = await listAccessEntries(db);
    expect(entries).toEqual([
      expect.objectContaining({
        id: ENTRY_DOMAIN,
        userCount: 3,
        publicDomain: true,
        isSelf: false,
      }),
      expect.objectContaining({ id: ENTRY_SELF, userCount: 1, publicDomain: false, isSelf: true }),
    ]);
    expect(db.calls[0]).toEqual({
      op: "rpc:admin_list_access_entries",
      args: { p_entry_ids: null },
    });
  });
});

describe("addAccessEntries", () => {
  it("inserts valid new entries, reports every token and counts matched users", async () => {
    const db = new FakeAdminDb(profiles);
    const newId = "40000000-0000-4000-8000-000000000009";
    db.upsertResult = {
      data: [{ id: newId, kind: "email", value: "an@corp.example" }],
      error: null,
    };
    db.rpcResults.admin_list_access_entries = {
      data: [entryRow(newId, "email", "an@corp.example", 1)],
      error: null,
    };
    db.rpcResults.admin_access_impact = {
      data: [{ matched_users: 1, losing_access: 1, becoming_guest: 0 }],
      error: null,
    };

    const result = await addAccessEntries(db, {
      input: "an@corp.example, corp.example, gmail.com, nope, AN@corp.example",
      note: "  Team  ",
    });

    expect(result.results.map((r) => [r.raw, r.status])).toEqual([
      ["an@corp.example", "added"],
      ["corp.example", "exists"],
      ["gmail.com", "publicDomainUnconfirmed"],
      ["nope", "invalid"],
      ["AN@corp.example", "duplicate"],
    ]);
    expect(result.added.map((entry) => entry.id)).toEqual([newId]);
    expect(result.matchedUsers).toBe(1);

    const upsert = db.calls.find((call) => call.op === "upsert:access_allowlist");
    expect(upsert?.args).toEqual({
      rows: [
        { kind: "email", value: "an@corp.example", note: "Team", created_by: SUPER },
        { kind: "domain", value: "corp.example", note: "Team", created_by: SUPER },
      ],
      options: { onConflict: "kind,value", ignoreDuplicates: true },
    });
  });

  it("adds a public domain only when confirmed", async () => {
    const db = new FakeAdminDb(profiles);
    await addAccessEntries(db, { input: ["gmail.com"], allowPublicDomains: true });
    const upsert = db.calls.find((call) => call.op === "upsert:access_allowlist");
    expect((upsert?.args as { rows: unknown[] }).rows).toEqual([
      { kind: "domain", value: "gmail.com", note: null, created_by: SUPER },
    ]);
  });

  it("skips the database when nothing is valid, and rejects empty input", async () => {
    const db = new FakeAdminDb(profiles);
    const result = await addAccessEntries(db, { input: "nope" });
    expect(result).toEqual({
      results: [
        { raw: "nope", kind: "domain", value: null, status: "invalid", publicDomain: false },
      ],
      added: [],
      matchedUsers: 0,
    });
    expect(db.calls).toEqual([]);
    await expectCode(addAccessEntries(db, { input: "  " }), "VALIDATION_FAILED");
    await expectCode(
      addAccessEntries(db, { input: Array.from({ length: 501 }, (_, i) => `u${i}@x.com`) }),
      "VALIDATION_FAILED",
    );
  });
});

describe("removeAccessEntries / previewAccessRemoval", () => {
  it("previews the impact of removing entries", async () => {
    const db = new FakeAdminDb(profiles);
    db.rpcResults.admin_access_impact = {
      data: [{ matched_users: 5, losing_access: 2, becoming_guest: 1 }],
      error: null,
    };
    await expect(previewAccessRemoval(db, { ids: [ENTRY_DOMAIN, ENTRY_DOMAIN] })).resolves.toEqual({
      matchedUsers: 5,
      losingAccess: 2,
      becomingGuest: 1,
    });
    expect(db.calls).toEqual([
      { op: "rpc:admin_access_impact", args: { p_entry_ids: [ENTRY_DOMAIN] } },
    ]);
  });

  it("refuses to remove the caller's own email entry, deleting nothing", async () => {
    const db = new FakeAdminDb(profiles);
    db.rpcResults.admin_list_access_entries = {
      data: [
        entryRow(ENTRY_DOMAIN, "domain", "corp.example"),
        entryRow(ENTRY_SELF, "email", "SUPER@corp.example"),
      ],
      error: null,
    };
    await expectCode(
      removeAccessEntries(db, { ids: [ENTRY_DOMAIN, ENTRY_SELF] }),
      "ACCESS_CANNOT_REMOVE_SELF",
    );
    expect(db.calls.some((call) => call.op.startsWith("delete:"))).toBe(false);
  });

  it("reports unknown ids", async () => {
    const db = new FakeAdminDb(profiles);
    db.rpcResults.admin_list_access_entries = { data: [], error: null };
    await expectCode(removeAccessEntries(db, { ids: [ENTRY_DOMAIN] }), "ACCESS_ENTRY_NOT_FOUND");
    await expectCode(removeAccessEntries(db, { ids: [] }), "VALIDATION_FAILED");
    await expectCode(removeAccessEntries(db, { ids: ["nope"] }), "VALIDATION_FAILED");
  });

  it("deletes and returns the impact computed before the delete", async () => {
    const db = new FakeAdminDb(profiles);
    db.rpcResults.admin_list_access_entries = {
      data: [entryRow(ENTRY_DOMAIN, "domain", "corp.example", 4)],
      error: null,
    };
    db.rpcResults.admin_access_impact = {
      data: [{ matched_users: 4, losing_access: 1, becoming_guest: 1 }],
      error: null,
    };
    db.deleteResult = { data: [{ id: ENTRY_DOMAIN }], error: null };
    await expect(removeAccessEntries(db, { ids: [ENTRY_DOMAIN] })).resolves.toEqual({
      removed: 1,
      impact: { matchedUsers: 4, losingAccess: 1, becomingGuest: 1 },
    });
    expect(db.calls.map((call) => call.op)).toEqual([
      "rpc:admin_list_access_entries",
      "rpc:admin_access_impact",
      "delete:access_allowlist",
    ]);
  });
});

describe("users", () => {
  it("lists users with defaults and flags the caller", async () => {
    const db = new FakeAdminDb(profiles);
    db.rpcResults.admin_list_users = {
      data: [
        userRow(SUPER, "super@corp.example", {
          is_super_admin: true,
          access: "super_admin",
          total_count: 2,
        }),
        userRow(OTHER, "an@corp.example", { total_count: 2 }),
      ],
      error: null,
    };
    const { users, total } = await listUsers(db, { query: "  corp " });
    expect(total).toBe(2);
    expect(users.map((user) => [user.email, user.isSelf, user.access])).toEqual([
      ["super@corp.example", true, "super_admin"],
      ["an@corp.example", false, "allowlist"],
    ]);
    expect(db.calls[0]).toEqual({
      op: "rpc:admin_list_users",
      args: { p_query: "corp", p_status: "all", p_limit: 50, p_offset: 0 },
    });
    await expectCode(listUsers(db, { limit: 0 }), "VALIDATION_FAILED");
    await expectCode(listUsers(db, { status: "gone" as never }), "VALIDATION_FAILED");
  });

  it("returns total 0 on an empty page", async () => {
    const db = new FakeAdminDb(profiles);
    await expect(listUsers(db, { offset: 100 })).resolves.toEqual({ users: [], total: 0 });
  });

  it("refuses to lock or demote yourself without calling the DB", async () => {
    const db = new FakeAdminDb(profiles);
    await expectCode(
      setUserDeactivated(db, { userId: SUPER, deactivated: true }),
      "USER_CANNOT_CHANGE_SELF",
    );
    await expectCode(
      setUserSuperAdmin(db, { userId: SUPER, superAdmin: false }),
      "USER_CANNOT_CHANGE_SELF",
    );
    expect(db.calls).toEqual([]);
  });

  it("locks a user and returns the refreshed row", async () => {
    const db = new FakeAdminDb(profiles);
    db.rpcResults.admin_list_users = {
      data: [
        userRow(OTHER, "an@corp.example", {
          deactivated_at: "2026-09-27T00:00:00+00:00",
          access: "deactivated",
        }),
      ],
      error: null,
    };
    const user = await setUserDeactivated(db, { userId: OTHER, deactivated: true });
    expect(user).toMatchObject({ id: OTHER, access: "deactivated", isSelf: false });
    expect(db.calls).toEqual([
      {
        op: "rpc:admin_set_user_deactivated",
        args: { p_user_id: OTHER, p_deactivated: true },
      },
      { op: "rpc:admin_list_users", args: { p_user_id: OTHER } },
    ]);
  });

  it.each(["LAST_SUPER_ADMIN", "USER_IS_GUEST", "USER_DEACTIVATED", "USER_NOT_FOUND"])(
    "passes the DB invariant %s through",
    async (code) => {
      const db = new FakeAdminDb(profiles);
      db.rpcResults.admin_set_super_admin = { data: null, error: { code: "23514", message: code } };
      await expectCode(setUserSuperAdmin(db, { userId: OTHER, superAdmin: true }), code);
    },
  );

  it("reports USER_NOT_FOUND when the refreshed row is missing", async () => {
    const db = new FakeAdminDb(profiles);
    await expectCode(setUserSuperAdmin(db, { userId: OTHER, superAdmin: true }), "USER_NOT_FOUND");
  });
});

describe("sendTestEmail", () => {
  const content = { subject: "Test email from KB", text: "Hello", html: "<p>Hello</p>" };

  it("sends to the caller in their locale by default", async () => {
    const sendMail = vi.fn(async () => {});
    const buildTestEmail = vi.fn(async () => content);
    const db = new FakeAdminDb(profiles);
    await expect(sendTestEmail(db, {}, { sendMail, buildTestEmail })).resolves.toEqual({
      to: "super@corp.example",
    });
    expect(buildTestEmail).toHaveBeenCalledWith({ locale: "en", sender: "super@corp.example" });
    expect(sendMail).toHaveBeenCalledWith({ to: "super@corp.example", ...content });
  });

  it("sends to a given address, validates it, and maps mail failures", async () => {
    const buildTestEmail = async () => content;
    const db = new FakeAdminDb(profiles);
    const sendMail = vi.fn(async () => {});
    await sendTestEmail(db, { to: "ops@corp.example" }, { sendMail, buildTestEmail });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "ops@corp.example" }));

    await expectCode(
      sendTestEmail(db, { to: "not-an-email" }, { sendMail, buildTestEmail }),
      "VALIDATION_FAILED",
    );
    await expectCode(
      sendTestEmail(
        db,
        {},
        {
          buildTestEmail,
          sendMail: async () => {
            throw Object.assign(new Error("MAIL_NOT_CONFIGURED"), { code: "MAIL_NOT_CONFIGURED" });
          },
        },
      ),
      "MAIL_NOT_CONFIGURED",
    );
    await expectCode(
      sendTestEmail(
        db,
        {},
        {
          buildTestEmail,
          sendMail: async () => {
            throw new Error("ECONNREFUSED");
          },
        },
      ),
      "MAIL_SEND_FAILED",
    );
  });

  it("is super admin only", async () => {
    const sendMail = vi.fn(async () => {});
    await expectCode(
      sendTestEmail(
        new FakeAdminDb(profiles, OTHER),
        {},
        {
          sendMail,
          buildTestEmail: async () => content,
        },
      ),
      "FORBIDDEN",
    );
    expect(sendMail).not.toHaveBeenCalled();
  });
});
