import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { Mailer } from "@/server/email/mailer";

import {
  changePageShareRole,
  leaveSharedPage,
  listPageShares,
  listSharedWithMe,
  PageShareError,
  removePageShare,
  sharePage,
  toPageShareError,
} from "./index";

const PAGE = "20000000-0000-4000-8000-000000000001";
const SPACE = "0b9a0000-0000-4000-8000-000000000001";
const USER = "5d2f0000-0000-4000-8000-000000000003";
const ADMIN = "5d2f0000-0000-4000-8000-000000000002";
const NOW = new Date("2026-10-14T02:00:00Z");

const pageRow = {
  id: PAGE,
  space_id: SPACE,
  short_id: "a1B2c3D4",
  slug: "hop-dong",
  title: "Hợp đồng",
  space: { slug: "design", name: "Design" },
};

type Result = { data: unknown; error: unknown };
type Call = { table?: string; rpc?: string; args?: unknown; ops: [string, ...unknown[]][] };

/**
 * Fake supabase-js client: each `from()`/`rpc()` takes the next scripted result; builders chain
 * and record their calls.
 */
function fakeClient(results: Result[], user: { id: string } | null = { id: ADMIN }) {
  const calls: Call[] = [];
  const next = () => results.shift() ?? { data: null, error: null };
  const builder = (call: Call) => {
    const result = next();
    const b: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "gt", "order", "insert", "update", "delete"]) {
      b[method] = (...args: unknown[]) => {
        call.ops.push([method, ...args]);
        return b;
      };
    }
    b.maybeSingle = () => Promise.resolve(result);
    b.single = () => Promise.resolve(result);
    b.then = (resolve: (value: unknown) => void) => resolve(result);
    return b;
  };
  const client = {
    auth: { getUser: async () => ({ data: { user } }) },
    from: vi.fn((table: string) => {
      const call: Call = { table, ops: [] };
      calls.push(call);
      return builder(call);
    }),
    rpc: vi.fn((fn: string, args: unknown) => {
      calls.push({ rpc: fn, args, ops: [] });
      return Promise.resolve(next());
    }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const ok = (data: unknown): Result => ({ data, error: null });

function mailer(): Mailer & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(async () => undefined) };
}

describe("toPageShareError", () => {
  it.each([
    [{ code: "P0001", message: "PAGE_SHARE_USER_INACTIVE" }, "PAGE_SHARE_USER_INACTIVE"],
    [{ code: "42501", message: "FORBIDDEN" }, "FORBIDDEN"],
    [{ code: "42501", message: "new row violates row-level security" }, "FORBIDDEN"],
    [{ code: "P0001", message: "RATE_LIMITED" }, "RATE_LIMITED"],
    [{ code: "22023", message: "VALIDATION_FAILED" }, "VALIDATION_FAILED"],
    [{ code: "XX000", message: "boom" }, "PAGE_SHARE_FAILED"],
  ])("maps %o to %s", (error, code) => {
    expect(toPageShareError(error).code).toBe(code);
  });
});

describe("listPageShares", () => {
  it("returns direct and inherited shares with the pending page invitations", async () => {
    const { client, calls } = fakeClient([
      ok(pageRow),
      ok([
        {
          user_id: USER,
          email: "khach@partner.vn",
          full_name: "Trần Khách",
          avatar_url: null,
          is_guest: true,
          role: "viewer",
          source_page_id: PAGE,
          source_page_title: "Hợp đồng",
          inherited: false,
          granted_by: ADMIN,
          created_at: NOW.toISOString(),
        },
      ]),
      ok([
        {
          id: "7a1c0000-0000-4000-8000-000000000001",
          space_id: SPACE,
          page_id: PAGE,
          email: "moi@partner.vn",
          role: "editor",
          invited_by: ADMIN,
          expires_at: "2026-10-28T02:00:00Z",
          accepted_at: null,
          accepted_by: null,
          revoked_at: null,
          created_at: NOW.toISOString(),
        },
      ]),
    ]);
    const output = await listPageShares(client, { pageId: PAGE }, () => NOW);
    expect(output.shares).toEqual([
      expect.objectContaining({ userId: USER, role: "viewer", isGuest: true, inherited: false }),
    ]);
    expect(output.invitations).toEqual([
      expect.objectContaining({ email: "moi@partner.vn", pageId: PAGE, status: "pending" }),
    ]);
    expect(calls[1]).toMatchObject({ rpc: "list_page_shares", args: { p_page_id: PAGE } });
    expect(calls[2]?.ops).toContainEqual(["eq", "page_id", PAGE]);
  });

  it("is PAGE_NOT_FOUND for a page the caller cannot see", async () => {
    const { client } = fakeClient([ok(null)]);
    await expect(listPageShares(client, { pageId: PAGE })).rejects.toSatisfy(
      (error) => error instanceof PageShareError && error.code === "PAGE_NOT_FOUND",
    );
  });

  it("rejects a malformed page id without querying", async () => {
    const { client, calls } = fakeClient([]);
    await expect(listPageShares(client, { pageId: "nope" })).rejects.toSatisfy(
      (error) => error instanceof PageShareError && error.code === "VALIDATION_FAILED",
    );
    expect(calls).toEqual([]);
  });
});

describe("sharePage", () => {
  it("shares with an existing account and emails them a link to the page", async () => {
    const mail = mailer();
    const { client, calls } = fakeClient([
      ok(pageRow),
      ok([{ status: "granted", user_id: USER, role: "editor", full_name: null, locale: "en" }]),
      ok({ full_name: "Nguyễn An", email: "an@thanhgo.com" }),
    ]);
    const result = await sharePage(
      client,
      { pageId: PAGE, email: " Khach@Partner.vn ", role: "editor" },
      { appUrl: "https://kb.example/", mailer: mail, now: () => NOW },
    );
    expect(result).toEqual({
      status: "granted",
      userId: USER,
      role: "editor",
      emailStatus: "sent",
    });
    expect(calls[1]).toMatchObject({
      rpc: "share_page",
      args: { p_page_id: PAGE, p_email: "khach@partner.vn", p_role: "editor" },
    });
    const message = mail.send.mock.calls[0]?.[0];
    expect(message.to).toBe("khach@partner.vn");
    expect(message.replyTo).toBe("an@thanhgo.com");
    expect(message.subject).toContain("Hợp đồng");
    expect(message.text).toContain("https://kb.example/s/design/p/hop-dong-a1B2c3D4");
  });

  it("invites an email without an account to the page", async () => {
    const { client, calls } = fakeClient([
      ok(pageRow),
      ok([{ status: "no_account", user_id: null, role: "viewer", full_name: null, locale: null }]),
      ok([]),
      ok({
        id: "7a1c0000-0000-4000-8000-000000000001",
        space_id: SPACE,
        page_id: PAGE,
        email: "moi@partner.vn",
        role: "viewer",
        invited_by: ADMIN,
        expires_at: "2026-10-28T02:00:00Z",
        accepted_at: null,
        accepted_by: null,
        revoked_at: null,
        created_at: NOW.toISOString(),
      }),
    ]);
    const result = await sharePage(
      client,
      { pageId: PAGE, email: "moi@partner.vn", role: "viewer" },
      { appUrl: "https://kb.example", mailer: null, now: () => NOW },
    );
    expect(result).toMatchObject({
      status: "invited",
      emailStatus: "skipped",
      invitation: { pageId: PAGE, email: "moi@partner.vn", status: "pending" },
    });
    if (result.status !== "invited") throw new Error("expected an invitation");
    expect(result.inviteUrl).toMatch(/^https:\/\/kb\.example\/invite\/[A-Za-z0-9_-]{43}$/);
    const insert = calls[3]?.ops.find(([op]) => op === "insert")?.[1] as Record<string, unknown>;
    expect(insert).toMatchObject({
      page_id: PAGE,
      space_id: SPACE,
      email: "moi@partner.vn",
      role: "viewer",
      invited_by: ADMIN,
      expires_at: "2026-10-28T02:00:00.000Z",
    });
    expect(insert.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a second pending invitation to the same page", async () => {
    const { client } = fakeClient([
      ok(pageRow),
      ok([{ status: "no_account", user_id: null, role: "viewer", full_name: null, locale: null }]),
      ok([{ id: "7a1c0000-0000-4000-8000-000000000001" }]),
    ]);
    await expect(
      sharePage(
        client,
        { pageId: PAGE, email: "moi@partner.vn", role: "viewer" },
        { appUrl: "https://kb.example", mailer: null },
      ),
    ).rejects.toSatisfy(
      (error) => error instanceof PageShareError && error.code === "INVITATION_ALREADY_PENDING",
    );
  });

  it("passes the database refusals through", async () => {
    const { client } = fakeClient([
      ok(pageRow),
      { data: null, error: { code: "P0001", message: "PAGE_SHARE_USER_INACTIVE" } },
    ]);
    await expect(
      sharePage(
        client,
        { pageId: PAGE, email: "locked@partner.vn", role: "viewer" },
        { appUrl: "https://kb.example", mailer: null },
      ),
    ).rejects.toSatisfy(
      (error) => error instanceof PageShareError && error.code === "PAGE_SHARE_USER_INACTIVE",
    );
  });

  it("never offers admin and validates the email", async () => {
    const { client } = fakeClient([]);
    const deps = { appUrl: "https://kb.example", mailer: null };
    for (const input of [
      { pageId: PAGE, email: "x@partner.vn", role: "admin" },
      { pageId: PAGE, email: "not-an-email", role: "viewer" },
    ]) {
      await expect(sharePage(client, input as never, deps)).rejects.toSatisfy(
        (error) => error instanceof PageShareError && error.code === "VALIDATION_FAILED",
      );
    }
  });

  it("requires a signed-in user", async () => {
    const { client } = fakeClient([], null);
    await expect(
      sharePage(
        client,
        { pageId: PAGE, email: "x@partner.vn", role: "viewer" },
        { appUrl: "https://kb.example", mailer: null },
      ),
    ).rejects.toSatisfy(
      (error) => error instanceof PageShareError && error.code === "UNAUTHORIZED",
    );
  });
});

describe("changing and removing shares", () => {
  it("changes the role of a share on this page", async () => {
    const { client, calls } = fakeClient([ok(pageRow), ok([{ user_id: USER }])]);
    await changePageShareRole(client, { pageId: PAGE, userId: USER, role: "editor" });
    expect(calls[1]?.table).toBe("page_permissions");
    expect(calls[1]?.ops).toEqual(
      expect.arrayContaining([
        ["update", { role: "editor" }],
        ["eq", "page_id", PAGE],
        ["eq", "user_id", USER],
      ]),
    );
  });

  it("reports PAGE_SHARE_NOT_FOUND when RLS matched nothing", async () => {
    const { client } = fakeClient([ok(pageRow), ok([])]);
    await expect(removePageShare(client, { pageId: PAGE, userId: USER })).rejects.toSatisfy(
      (error) => error instanceof PageShareError && error.code === "PAGE_SHARE_NOT_FOUND",
    );
  });

  it("lets the caller leave a page shared with them", async () => {
    const { client, calls } = fakeClient([ok([{ user_id: USER }])], { id: USER });
    await leaveSharedPage(client, { pageId: PAGE });
    expect(calls[0]?.ops).toEqual(expect.arrayContaining([["delete"], ["eq", "user_id", USER]]));
  });
});

describe("listSharedWithMe", () => {
  it("maps the shared pages with their Space", async () => {
    const { client } = fakeClient([
      ok([
        {
          page_id: PAGE,
          short_id: "a1B2c3D4",
          slug: "hop-dong",
          title: "Hợp đồng",
          icon: "📄",
          space_id: SPACE,
          space_slug: "design",
          space_name: "Design",
          space_icon: null,
          role: "viewer",
          shared_at: NOW.toISOString(),
          has_children: true,
        },
      ]),
    ]);
    expect(await listSharedWithMe(client)).toEqual([
      {
        pageId: PAGE,
        shortId: "a1B2c3D4",
        slug: "hop-dong",
        title: "Hợp đồng",
        icon: "📄",
        spaceId: SPACE,
        spaceSlug: "design",
        spaceName: "Design",
        spaceIcon: null,
        role: "viewer",
        sharedAt: NOW.toISOString(),
        hasChildren: true,
      },
    ]);
  });
});
