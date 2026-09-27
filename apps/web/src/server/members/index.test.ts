import { describe, expect, it, vi } from "vitest";

import type { MailMessage, Mailer } from "@/server/email/mailer";

import {
  MemberError,
  acceptInvitation,
  addMember,
  changeMemberRole,
  createInvitation,
  createInvitationInputSchema,
  generateInvitationToken,
  getInvitation,
  hashInvitationToken,
  invitationUrl,
  leaveSpace,
  listInvitations,
  listMembers,
  removeMember,
  resendInvitation,
  revokeInvitation,
  searchMemberCandidates,
  toMemberError,
  type MemberErrorCode,
} from "./index";
import { ScriptedMembersDb, fail, filterValue, ok, type RecordedCall } from "./test-support";

const CALLER = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const SPACE = "00000000-0000-4000-8000-000000000001";
const INVITATION = "20000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-27T00:00:00.000Z");
const TOKEN = "a".repeat(43);

const memberRow = (overrides: Record<string, unknown> = {}) => ({
  user_id: OTHER,
  role: "editor",
  email: "other@thanhgo.com",
  full_name: "Người Khác",
  avatar_url: null,
  is_guest: false,
  added_by: CALLER,
  created_at: "2026-09-01T00:00:00+00:00",
  updated_at: "2026-09-01T00:00:00+00:00",
  ...overrides,
});

const invitationRow = (overrides: Record<string, unknown> = {}) => ({
  id: INVITATION,
  space_id: SPACE,
  email: "guest@partner.vn",
  role: "viewer",
  invited_by: CALLER,
  expires_at: "2026-10-11T00:00:00+00:00",
  accepted_at: null,
  accepted_by: null,
  revoked_at: null,
  created_at: "2026-09-27T00:00:00+00:00",
  ...overrides,
});

async function expectCode(promise: Promise<unknown>, code: MemberErrorCode) {
  await expect(promise).rejects.toSatisfy(
    (error) => error instanceof MemberError && error.code === code,
  );
}

function recordingMailer(impl?: (message: MailMessage) => Promise<void>) {
  const sent: MailMessage[] = [];
  const mailer: Mailer = {
    send: vi.fn(async (message: MailMessage) => {
      sent.push(message);
      await impl?.(message);
    }),
  };
  return { mailer, sent };
}

/** Default answers for the reads every invitation write does. */
function invitationResponder(
  overrides: (call: RecordedCall) => ReturnType<typeof ok> | undefined = () => undefined,
) {
  return (call: RecordedCall) => {
    const custom = overrides(call);
    if (custom) return custom;
    if (call.target === "list_space_members") return ok([]);
    if (call.target === "invitations" && call.action === "select" && !call.single) return ok([]);
    if (call.target === "invitations" && call.action === "insert")
      return ok(
        invitationRow({ email: call.payload?.email, expires_at: call.payload?.expires_at }),
      );
    if (call.target === "spaces") return ok({ id: SPACE, name: "Thiết kế <Design>" });
    if (call.target === "profiles" && filterValue(call, "id") === CALLER)
      return ok({ full_name: "Nguyễn An", email: "an@thanhgo.com" });
    if (call.target === "profiles") return ok(null);
    return ok(null);
  };
}

describe("tokens", () => {
  it("hashes with sha256 hex, like SQL app.invitation_token_hash", () => {
    expect(hashInvitationToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("generates distinct 43-char base64url tokens", () => {
    const a = generateInvitationToken();
    const b = generateInvitationToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("builds the invite URL without a double slash", () => {
    expect(invitationUrl("https://kb.example.com/", "tok")).toBe(
      "https://kb.example.com/invite/tok",
    );
  });
});

describe("toMemberError", () => {
  it.each([
    [{ code: "23514", message: "SPACE_REQUIRES_ADMIN" }, "SPACE_REQUIRES_ADMIN"],
    [{ code: "23514", message: "GUEST_CANNOT_BE_SPACE_ADMIN" }, "GUEST_CANNOT_BE_SPACE_ADMIN"],
    [{ code: "P0001", message: "INVITATION_EXPIRED" }, "INVITATION_EXPIRED"],
    [{ code: "P0001", message: "RATE_LIMITED" }, "RATE_LIMITED"],
    [{ code: "42501", message: "new row violates row-level security policy" }, "FORBIDDEN"],
    [{ code: "23514", message: "some_check" }, "VALIDATION_FAILED"],
    [{ code: "23514", message: "INVITATION_IMMUTABLE" }, "VALIDATION_FAILED"],
    [{ code: "XX000", message: "boom" }, "MEMBER_ACTION_FAILED"],
  ] as const)("maps %o to %s", (error, code) => {
    expect(toMemberError(error).code).toBe(code);
  });

  it("applies per-call overrides for SQLSTATEs", () => {
    expect(
      toMemberError({ code: "23505", message: "dup" }, { "23505": "MEMBER_ALREADY_EXISTS" }).code,
    ).toBe("MEMBER_ALREADY_EXISTS");
  });
});

describe("listMembers", () => {
  it("requires a signed-in user", async () => {
    const db = new ScriptedMembersDb(() => ok(null), null);
    await expectCode(listMembers(db, { spaceId: SPACE }), "UNAUTHORIZED");
  });

  it("rejects a non-uuid space id", async () => {
    const db = new ScriptedMembersDb(() => ok(null));
    await expectCode(listMembers(db, { spaceId: "nope" }), "VALIDATION_FAILED");
  });

  it("reports SPACE_NOT_FOUND when the Space is not visible", async () => {
    const db = new ScriptedMembersDb(() => ok(null));
    await expectCode(listMembers(db, { spaceId: SPACE }), "SPACE_NOT_FOUND");
  });

  it("maps rows from list_space_members", async () => {
    const db = new ScriptedMembersDb((call) =>
      call.target === "spaces"
        ? ok({ id: SPACE })
        : ok([
            memberRow(),
            memberRow({ user_id: CALLER, email: null, full_name: null, is_guest: null }),
          ]),
    );
    const { members } = await listMembers(db, { spaceId: SPACE });
    expect(members).toEqual([
      {
        userId: OTHER,
        role: "editor",
        email: "other@thanhgo.com",
        fullName: "Người Khác",
        avatarUrl: null,
        isGuest: false,
        addedBy: CALLER,
        joinedAt: "2026-09-01T00:00:00+00:00",
        updatedAt: "2026-09-01T00:00:00+00:00",
      },
      expect.objectContaining({ userId: CALLER, email: null, isGuest: null }),
    ]);
    expect(db.callsTo("list_space_members")[0]?.args).toEqual({ p_space_id: SPACE });
  });
});

describe("searchMemberCandidates", () => {
  it("rejects a blank query", async () => {
    const db = new ScriptedMembersDb(() => ok([]));
    await expectCode(
      searchMemberCandidates(db, { spaceId: SPACE, query: "  " }),
      "VALIDATION_FAILED",
    );
  });

  it("passes the trimmed query and default limit, and maps rows", async () => {
    const db = new ScriptedMembersDb(() =>
      ok([{ user_id: OTHER, email: "binh@thanhgo.com", full_name: "Lê Bình", avatar_url: null }]),
    );
    const { candidates } = await searchMemberCandidates(db, { spaceId: SPACE, query: " binh " });
    expect(candidates).toEqual([
      { userId: OTHER, email: "binh@thanhgo.com", fullName: "Lê Bình", avatarUrl: null },
    ]);
    expect(db.calls[0]?.args).toEqual({ p_space_id: SPACE, p_query: "binh", p_limit: 10 });
  });
});

describe("addMember", () => {
  const profile = (overrides: Record<string, unknown> = {}) =>
    ok({ id: OTHER, is_guest: false, deactivated_at: null, ...overrides });

  it.each([
    ["an invisible user", ok(null)],
    ["a guest", profile({ is_guest: true })],
    ["a deactivated user", profile({ deactivated_at: "2026-09-01T00:00:00Z" })],
  ])("refuses %s with MEMBER_USER_NOT_FOUND", async (_label, answer) => {
    const db = new ScriptedMembersDb((call) => (call.target === "profiles" ? answer : ok(null)));
    await expectCode(
      addMember(db, { spaceId: SPACE, userId: OTHER, role: "viewer" }),
      "MEMBER_USER_NOT_FOUND",
    );
    expect(db.callsTo("space_members", "insert")).toHaveLength(0);
  });

  it("inserts with added_by = caller and returns the member", async () => {
    const db = new ScriptedMembersDb((call) => {
      if (call.target === "profiles") return profile();
      if (call.target === "space_members") return ok({ user_id: OTHER });
      return ok([memberRow()]);
    });
    const member = await addMember(db, { spaceId: SPACE, userId: OTHER, role: "editor" });
    expect(member.userId).toBe(OTHER);
    expect(db.callsTo("space_members", "insert")[0]?.payload).toEqual({
      space_id: SPACE,
      user_id: OTHER,
      role: "editor",
      added_by: CALLER,
    });
  });

  it("maps a duplicate to MEMBER_ALREADY_EXISTS", async () => {
    const db = new ScriptedMembersDb((call) =>
      call.target === "profiles" ? profile() : fail("23505", "duplicate key value"),
    );
    await expectCode(
      addMember(db, { spaceId: SPACE, userId: OTHER, role: "viewer" }),
      "MEMBER_ALREADY_EXISTS",
    );
  });

  it("maps an RLS denial to FORBIDDEN when the Space is visible, else SPACE_NOT_FOUND", async () => {
    const answer = (spaceVisible: boolean) => (call: RecordedCall) => {
      if (call.target === "profiles") return profile();
      if (call.target === "space_members") return fail("42501", "row-level security");
      return ok(spaceVisible ? { id: SPACE } : null);
    };
    await expectCode(
      addMember(new ScriptedMembersDb(answer(true)), {
        spaceId: SPACE,
        userId: OTHER,
        role: "viewer",
      }),
      "FORBIDDEN",
    );
    await expectCode(
      addMember(new ScriptedMembersDb(answer(false)), {
        spaceId: SPACE,
        userId: OTHER,
        role: "viewer",
      }),
      "SPACE_NOT_FOUND",
    );
  });
});

describe("changeMemberRole / removeMember", () => {
  it("passes trigger codes through", async () => {
    for (const code of ["SPACE_REQUIRES_ADMIN", "GUEST_CANNOT_BE_SPACE_ADMIN"] as const) {
      const db = new ScriptedMembersDb(() => fail("23514", code));
      await expectCode(
        changeMemberRole(db, { spaceId: SPACE, userId: OTHER, role: "admin" }),
        code,
      );
    }
  });

  it("diagnoses an update that matched nothing", async () => {
    const scenario = (space: unknown, member: unknown) => (call: RecordedCall) => {
      if (call.action === "update") return ok(null);
      if (call.target === "spaces") return ok(space);
      return ok(member);
    };
    const input = { spaceId: SPACE, userId: OTHER, role: "viewer" } as const;
    await expectCode(
      changeMemberRole(new ScriptedMembersDb(scenario(null, null)), input),
      "SPACE_NOT_FOUND",
    );
    await expectCode(
      changeMemberRole(new ScriptedMembersDb(scenario({ id: SPACE }, null)), input),
      "MEMBER_NOT_FOUND",
    );
    await expectCode(
      changeMemberRole(new ScriptedMembersDb(scenario({ id: SPACE }, { user_id: OTHER })), input),
      "FORBIDDEN",
    );
  });

  it("returns the updated member", async () => {
    const db = new ScriptedMembersDb((call) =>
      call.action === "update" ? ok({ user_id: OTHER }) : ok([memberRow({ role: "viewer" })]),
    );
    expect(
      await changeMemberRole(db, { spaceId: SPACE, userId: OTHER, role: "viewer" }),
    ).toMatchObject({
      userId: OTHER,
      role: "viewer",
    });
    expect(db.callsTo("space_members", "update")[0]?.payload).toEqual({ role: "viewer" });
  });

  it("removes a member, and reports FORBIDDEN when RLS hid the delete", async () => {
    const removed = new ScriptedMembersDb(() => ok([{ user_id: OTHER }]));
    await expect(removeMember(removed, { spaceId: SPACE, userId: OTHER })).resolves.toBeUndefined();

    const hidden = new ScriptedMembersDb((call) =>
      call.action === "delete"
        ? ok([])
        : ok(call.target === "spaces" ? { id: SPACE } : { user_id: OTHER }),
    );
    await expectCode(removeMember(hidden, { spaceId: SPACE, userId: OTHER }), "FORBIDDEN");
  });
});

describe("leaveSpace", () => {
  it("deletes the caller's own row", async () => {
    const db = new ScriptedMembersDb(() => ok([{ user_id: CALLER }]));
    await leaveSpace(db, { spaceId: SPACE });
    expect(filterValue(db.callsTo("space_members", "delete")[0]!, "user_id")).toBe(CALLER);
  });

  it("reports SPACE_REQUIRES_ADMIN for the last admin", async () => {
    const db = new ScriptedMembersDb(() => fail("23514", "SPACE_REQUIRES_ADMIN"));
    await expectCode(leaveSpace(db, { spaceId: SPACE }), "SPACE_REQUIRES_ADMIN");
  });

  it("reports MEMBER_NOT_FOUND for an implicit viewer, SPACE_NOT_FOUND for an invisible Space", async () => {
    const visible = new ScriptedMembersDb((call) =>
      call.action === "delete" ? ok([]) : ok({ id: SPACE }),
    );
    await expectCode(leaveSpace(visible, { spaceId: SPACE }), "MEMBER_NOT_FOUND");
    const invisible = new ScriptedMembersDb((call) =>
      call.action === "delete" ? ok([]) : ok(null),
    );
    await expectCode(leaveSpace(invisible, { spaceId: SPACE }), "SPACE_NOT_FOUND");
  });
});

describe("listInvitations", () => {
  it("computes status and filters to open invitations by default", async () => {
    const db = new ScriptedMembersDb(() =>
      ok([
        invitationRow(),
        invitationRow({
          id: "20000000-0000-4000-8000-000000000002",
          expires_at: "2026-09-26T00:00:00Z",
        }),
      ]),
    );
    const { invitations } = await listInvitations(db, { spaceId: SPACE }, () => NOW);
    expect(invitations.map((i) => i.status)).toEqual(["pending", "expired"]);
    expect(db.calls[0]?.filters).toEqual(
      expect.arrayContaining([
        { op: "is", column: "accepted_at", value: null },
        { op: "is", column: "revoked_at", value: null },
      ]),
    );
  });

  it("includes accepted/revoked on request", async () => {
    const db = new ScriptedMembersDb(() =>
      ok([
        invitationRow({ accepted_at: NOW.toISOString(), accepted_by: OTHER }),
        invitationRow({ revoked_at: NOW.toISOString() }),
      ]),
    );
    const { invitations } = await listInvitations(
      db,
      { spaceId: SPACE, includeInactive: true },
      () => NOW,
    );
    expect(invitations.map((i) => i.status)).toEqual(["accepted", "revoked"]);
    expect(db.calls[0]?.filters.some((f) => f.op === "is")).toBe(false);
  });

  it("reports SPACE_NOT_FOUND when empty and the Space is invisible", async () => {
    const db = new ScriptedMembersDb((call) => (call.target === "spaces" ? ok(null) : ok([])));
    await expectCode(listInvitations(db, { spaceId: SPACE }), "SPACE_NOT_FOUND");
  });
});

describe("createInvitation", () => {
  it("normalizes the email and restricts the role", () => {
    const parsed = createInvitationInputSchema.parse({
      spaceId: SPACE,
      email: "  Guest@Partner.VN ",
      role: "editor",
    });
    expect(parsed.email).toBe("guest@partner.vn");
    expect(
      createInvitationInputSchema.safeParse({ spaceId: SPACE, email: "x@y.z", role: "admin" })
        .success,
    ).toBe(false);
    expect(
      createInvitationInputSchema.safeParse({
        spaceId: SPACE,
        email: "not-an-email",
        role: "viewer",
      }).success,
    ).toBe(false);
  });

  it("stores only the token hash, expires in 14 days and emails the link bilingually", async () => {
    const { mailer, sent } = recordingMailer();
    const db = new ScriptedMembersDb(invitationResponder());
    const result = await createInvitation(
      db,
      { spaceId: SPACE, email: "Guest@Partner.vn", role: "viewer" },
      { appUrl: "https://kb.example.com", mailer, now: () => NOW },
    );

    const insert = db.callsTo("invitations", "insert")[0]!;
    const token = result.inviteUrl.split("/invite/")[1]!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(insert.payload).toEqual({
      space_id: SPACE,
      email: "guest@partner.vn",
      role: "viewer",
      token_hash: hashInvitationToken(token),
      invited_by: CALLER,
      expires_at: "2026-10-11T00:00:00.000Z",
    });
    expect(JSON.stringify(insert.payload)).not.toContain(token);
    expect(result.emailStatus).toBe("sent");
    expect(result.invitation).toMatchObject({ status: "pending", email: "guest@partner.vn" });

    const [message] = sent;
    expect(message?.to).toBe("guest@partner.vn");
    expect(message?.replyTo).toBe("an@thanhgo.com");
    expect(message?.subject).toBe(
      "Nguyễn An mời bạn vào không gian Thiết kế <Design> / Nguyễn An invited you to the Thiết kế <Design> space",
    );
    expect(message?.text).toContain(result.inviteUrl);
    expect(message?.html).toContain("Thiết kế &lt;Design&gt;");
    expect(message?.html).not.toContain("<Design>");
    expect(message?.html).toContain('lang="vi"');
    expect(message?.html).toContain('lang="en"');
  });

  it("uses only the invitee's locale when their profile is visible", async () => {
    const { mailer, sent } = recordingMailer();
    const db = new ScriptedMembersDb(
      invitationResponder((call) =>
        call.target === "profiles" && filterValue(call, "email") ? ok({ locale: "en" }) : undefined,
      ),
    );
    await createInvitation(
      db,
      { spaceId: SPACE, email: "guest@partner.vn", role: "editor" },
      {
        appUrl: "https://kb.example.com",
        mailer,
        now: () => NOW,
      },
    );
    expect(sent[0]?.subject).toBe("Nguyễn An invited you to the Thiết kế <Design> space");
    expect(sent[0]?.text).toContain("Your access: Can view.");
    expect(sent[0]?.html).not.toContain('lang="vi"');
  });

  it("reports skipped without SMTP and failed on an SMTP error, keeping the invitation", async () => {
    const skipped = await createInvitation(
      new ScriptedMembersDb(invitationResponder()),
      { spaceId: SPACE, email: "guest@partner.vn", role: "viewer" },
      { appUrl: "https://kb.example.com", mailer: null },
    );
    expect(skipped.emailStatus).toBe("skipped");

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { mailer } = recordingMailer(async () => {
      throw new Error("535 auth failed");
    });
    const failed = await createInvitation(
      new ScriptedMembersDb(invitationResponder()),
      { spaceId: SPACE, email: "guest@partner.vn", role: "viewer" },
      { appUrl: "https://kb.example.com", mailer },
    );
    expect(failed.emailStatus).toBe("failed");
    expect(failed.invitation.id).toBe(INVITATION);
    errorSpy.mockRestore();
  });

  it("refuses an email that is already a member", async () => {
    const db = new ScriptedMembersDb(
      invitationResponder((call) =>
        call.target === "list_space_members"
          ? ok([memberRow({ email: "Guest@Partner.vn" })])
          : undefined,
      ),
    );
    await expectCode(
      createInvitation(
        db,
        { spaceId: SPACE, email: "guest@partner.vn", role: "viewer" },
        { appUrl: "x", mailer: null },
      ),
      "MEMBER_ALREADY_EXISTS",
    );
  });

  it("refuses a second open invitation for the same email", async () => {
    const db = new ScriptedMembersDb(
      invitationResponder((call) =>
        call.target === "invitations" && call.action === "select"
          ? ok([{ id: INVITATION }])
          : undefined,
      ),
    );
    await expectCode(
      createInvitation(
        db,
        { spaceId: SPACE, email: "guest@partner.vn", role: "viewer" },
        { appUrl: "x", mailer: null, now: () => NOW },
      ),
      "INVITATION_ALREADY_PENDING",
    );
    const pendingQuery = db.callsTo("invitations", "select")[0]!;
    expect(pendingQuery.filters).toContainEqual({
      op: "gt",
      column: "expires_at",
      value: NOW.toISOString(),
    });
  });

  it("maps an RLS denial (not a Space admin) to FORBIDDEN", async () => {
    const db = new ScriptedMembersDb(
      invitationResponder((call) => (call.action === "insert" ? fail("42501", "rls") : undefined)),
    );
    await expectCode(
      createInvitation(
        db,
        { spaceId: SPACE, email: "guest@partner.vn", role: "viewer" },
        { appUrl: "x", mailer: null },
      ),
      "FORBIDDEN",
    );
  });
});

describe("resendInvitation / revokeInvitation", () => {
  it("refuses used and revoked invitations", async () => {
    for (const [row, code] of [
      [
        invitationRow({ accepted_at: NOW.toISOString(), accepted_by: OTHER }),
        "INVITATION_ALREADY_USED",
      ],
      [invitationRow({ revoked_at: NOW.toISOString() }), "INVITATION_REVOKED"],
    ] as const) {
      const db = new ScriptedMembersDb(() => ok(row));
      await expectCode(
        resendInvitation(db, { invitationId: INVITATION }, { appUrl: "x", mailer: null }),
        code,
      );
      await expectCode(revokeInvitation(db, { invitationId: INVITATION }), code);
    }
  });

  it("reports INVITATION_NOT_FOUND when RLS hides the invitation", async () => {
    const db = new ScriptedMembersDb(() => ok(null));
    await expectCode(revokeInvitation(db, { invitationId: INVITATION }), "INVITATION_NOT_FOUND");
  });

  it("rotates the token and restarts the expiry on resend", async () => {
    const db = new ScriptedMembersDb(
      invitationResponder((call) =>
        call.target === "invitations"
          ? ok(
              invitationRow(
                call.action === "update" ? { expires_at: call.payload?.expires_at } : {},
              ),
            )
          : undefined,
      ),
    );
    const result = await resendInvitation(
      db,
      { invitationId: INVITATION },
      { appUrl: "https://kb.example.com", mailer: null, now: () => NOW },
    );
    const update = db.callsTo("invitations", "update")[0]!;
    const token = result.inviteUrl.split("/invite/")[1]!;
    expect(update.payload).toEqual({
      token_hash: hashInvitationToken(token),
      expires_at: "2026-10-11T00:00:00.000Z",
    });
    expect(result.invitation.status).toBe("pending");
  });

  it("revokes a pending invitation", async () => {
    const db = new ScriptedMembersDb((call) =>
      ok(invitationRow(call.action === "update" ? { revoked_at: NOW.toISOString() } : {})),
    );
    const revoked = await revokeInvitation(db, { invitationId: INVITATION }, () => NOW);
    expect(revoked.status).toBe("revoked");
    expect(db.callsTo("invitations", "update")[0]?.payload).toEqual({
      revoked_at: NOW.toISOString(),
    });
  });
});

describe("getInvitation / acceptInvitation", () => {
  const previewRow = {
    invitation_id: INVITATION,
    space_id: SPACE,
    space_slug: "design",
    space_name: "Design",
    space_icon: null,
    role: "editor",
    email: "guest@partner.vn",
    inviter_name: "Nguyễn An",
    inviter_email: "an@thanhgo.com",
    expires_at: "2026-10-11T00:00:00+00:00",
    status: "pending",
    email_matches: true,
  };

  it("treats a malformed token as INVITATION_NOT_FOUND without querying", async () => {
    const db = new ScriptedMembersDb(() => ok([previewRow]));
    await expectCode(getInvitation(db, { token: "bad token!" }), "INVITATION_NOT_FOUND");
    await expectCode(acceptInvitation(db, { token: "x" }), "INVITATION_NOT_FOUND");
    expect(db.calls).toHaveLength(0);
  });

  it("requires a signed-in user", async () => {
    const db = new ScriptedMembersDb(() => ok([previewRow]), null);
    await expectCode(getInvitation(db, { token: TOKEN }), "UNAUTHORIZED");
    await expectCode(acceptInvitation(db, { token: TOKEN }), "UNAUTHORIZED");
  });

  it("maps the preview row, and an empty result to INVITATION_NOT_FOUND", async () => {
    const db = new ScriptedMembersDb(() => ok([previewRow]));
    expect(await getInvitation(db, { token: TOKEN })).toMatchObject({
      invitationId: INVITATION,
      spaceSlug: "design",
      role: "editor",
      status: "pending",
      emailMatches: true,
    });
    expect(db.calls[0]?.args).toEqual({ p_token: TOKEN });
    await expectCode(
      getInvitation(new ScriptedMembersDb(() => ok([])), { token: TOKEN }),
      "INVITATION_NOT_FOUND",
    );
  });

  it.each([
    "INVITATION_NOT_FOUND",
    "INVITATION_ALREADY_USED",
    "INVITATION_REVOKED",
    "INVITATION_EXPIRED",
    "INVITATION_EMAIL_MISMATCH",
    "FORBIDDEN",
  ] as const)("passes %s from accept_invitation through", async (code) => {
    const db = new ScriptedMembersDb(() => fail("P0001", code));
    await expectCode(acceptInvitation(db, { token: TOKEN }), code);
  });

  it("returns the joined Space", async () => {
    const db = new ScriptedMembersDb(() =>
      ok([{ space_id: SPACE, space_slug: "design", role: "viewer" }]),
    );
    expect(await acceptInvitation(db, { token: TOKEN })).toEqual({
      spaceId: SPACE,
      spaceSlug: "design",
      role: "viewer",
    });
  });
});
