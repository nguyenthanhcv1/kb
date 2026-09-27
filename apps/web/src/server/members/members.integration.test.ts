/**
 * Members + invitations through supabase-js → PostgREST → RLS/triggers/SQL functions (T1.5a
 * acceptance: invite → accept → member of the Space; token single-use; expired → error).
 *
 * Needs `supabase start` (at least db, rest, kong):
 *   MEMBERS_TEST_SUPABASE_URL=http://127.0.0.1:54321
 *   MEMBERS_TEST_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long
 *   MEMBERS_TEST_ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
 * Optional, to also send the invitation through real SMTP and read the link back from Mailpit
 * (`[local_smtp] smtp_port` in supabase/config.toml):
 *   MEMBERS_TEST_SMTP_HOST=127.0.0.1  MEMBERS_TEST_SMTP_PORT=54325
 *   MEMBERS_TEST_MAILPIT_URL=http://127.0.0.1:54324
 * Skipped when the required variables are unset.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSmtpMailer, type Mailer } from "@/server/email/mailer";

import {
  MemberError,
  acceptInvitation,
  addMember,
  changeMemberRole,
  createInvitation,
  getInvitation,
  leaveSpace,
  listInvitations,
  listMembers,
  removeMember,
  resendInvitation,
  revokeInvitation,
  searchMemberCandidates,
  type InvitationDeps,
  type MemberErrorCode,
  type MembersDb,
} from "./index";

const URL = process.env.MEMBERS_TEST_SUPABASE_URL;
const SECRET = process.env.MEMBERS_TEST_JWT_SECRET;
const ADMIN_URL = process.env.MEMBERS_TEST_ADMIN_DATABASE_URL;
const SMTP_HOST = process.env.MEMBERS_TEST_SMTP_HOST;
const SMTP_PORT = Number(process.env.MEMBERS_TEST_SMTP_PORT ?? "54325");
const MAILPIT_URL = process.env.MEMBERS_TEST_MAILPIT_URL;

const run = randomUUID().slice(0, 8);
const ids = {
  admin: randomUUID(),
  editor: randomUUID(),
  viewer: randomUUID(),
  outsider: randomUUID(),
  candidate: randomUUID(),
  invitee: randomUUID(),
  otherGuest: randomUUID(),
  space: randomUUID(),
};
type Who = Exclude<keyof typeof ids, "space">;
const email = (who: Who) =>
  who === "invitee" || who === "otherGuest"
    ? `members-${run}-${who.toLowerCase()}@partner.test`
    : `members-${run}-${who.toLowerCase()}@example.com`;

let db: pg.Client;
const as = {} as Record<Who, MembersDb>;
let deps: InvitationDeps;

async function jwt(claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(SECRET));
}

async function clientFor(userId: string): Promise<MembersDb> {
  const anon = await jwt({ role: "anon" });
  const token = await jwt({ role: "authenticated", sub: userId, aud: "authenticated" });
  const client = createClient(URL!, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const port = client as unknown as MembersDb;
  // `auth.getUser()` would call GoTrue (not running in CI); the JWT's `sub` is what RLS uses.
  return {
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
    from: (table) => port.from(table),
    rpc: (fn, args) => port.rpc(fn, args),
  };
}

async function expectCode(promise: Promise<unknown>, code: MemberErrorCode) {
  await expect(promise).rejects.toSatisfy(
    (error) => error instanceof MemberError && error.code === code,
  );
}

const tokenOf = (inviteUrl: string) => decodeURIComponent(inviteUrl.split("/invite/")[1]!);

/** Invite link as received by the invitee: from Mailpit when SMTP is wired, else the returned URL. */
async function receivedToken(to: string, fallbackUrl: string): Promise<string> {
  if (!MAILPIT_URL || !SMTP_HOST) return tokenOf(fallbackUrl);
  for (let attempt = 0; attempt < 20; attempt++) {
    const search = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    ).then((r) => r.json() as Promise<{ messages: { ID: string }[] }>);
    const [latest] = search.messages;
    if (latest) {
      const message = await fetch(`${MAILPIT_URL}/api/v1/message/${latest.ID}`).then(
        (r) => r.json() as Promise<{ Text: string; Subject: string; HTML: string }>,
      );
      expect(message.Subject).toContain("Members test");
      expect(message.HTML).toContain('lang="vi"');
      const match = /\/invite\/([A-Za-z0-9_-]+)/.exec(message.Text);
      expect(match).not.toBeNull();
      return match![1]!;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no email for ${to} in Mailpit`);
}

describe.skipIf(!URL || !SECRET || !ADMIN_URL)("members and invitations through PostgREST", () => {
  beforeAll(async () => {
    db = new pg.Client({ connectionString: ADMIN_URL });
    await db.connect();
    const internal = [ids.admin, ids.editor, ids.viewer, ids.outsider, ids.candidate];
    const all = [...internal, ids.invitee, ids.otherGuest];
    await db.query("begin");
    await db.query(
      "insert into auth.users (id, email) select * from unnest($1::uuid[], $2::text[])",
      [all, (Object.keys(ids).filter((k) => k !== "space") as Who[]).map(email)],
    );
    await db.query("select set_config('request.jwt.claim.role', 'service_role', true)");
    // New auth users are guests unless allowlisted; make the internal ones internal.
    await db.query("update public.profiles set is_guest = false where id = any($1::uuid[])", [
      internal,
    ]);
    await db.query("update public.profiles set full_name = $2 where id = $1", [
      ids.candidate,
      `Trần Ứng Viên ${run}`,
    ]);
    await db.query("select set_config('request.jwt.claim.role', '', true)");
    await db.query(
      "insert into public.spaces (id, slug, name, created_by) values ($1, $2, 'Members test', $3)",
      [ids.space, `mb-${run}`, ids.admin],
    );
    await db.query(
      `insert into public.space_members (space_id, user_id, role, added_by)
       values ($1, $2, 'editor', $4), ($1, $3, 'viewer', $4)`,
      [ids.space, ids.editor, ids.viewer, ids.admin],
    );
    await db.query("commit");
    for (const who of Object.keys(ids).filter((k) => k !== "space") as Who[])
      as[who] = await clientFor(ids[who]);

    const mailer: Mailer | null = SMTP_HOST
      ? createSmtpMailer({ host: SMTP_HOST, port: SMTP_PORT, from: "KB <kb@example.com>" })
      : null;
    deps = { appUrl: "http://localhost:3000", mailer };
  });

  afterAll(async () => {
    if (!db) return;
    // Rows stay (like the pages test): deleting the Space would trip the last-admin guard, and
    // audit rows are immutable anyway. Archiving hides it from everyone.
    await db.query("update public.spaces set archived_at = now() where id = $1", [ids.space]);
    await db.end();
  });

  it("lists members and searches internal candidates by admin only", async () => {
    const { members } = await listMembers(as.viewer, { spaceId: ids.space });
    expect(members.map((m) => [m.userId, m.role])).toEqual([
      [ids.admin, "admin"],
      [ids.editor, "editor"],
      [ids.viewer, "viewer"],
    ]);
    await expectCode(listMembers(as.outsider, { spaceId: ids.space }), "SPACE_NOT_FOUND");

    const { candidates } = await searchMemberCandidates(as.admin, {
      spaceId: ids.space,
      query: `ung vien ${run}`,
    });
    expect(candidates.map((c) => c.userId)).toEqual([ids.candidate]);
    expect(
      (await searchMemberCandidates(as.editor, { spaceId: ids.space, query: `ung vien ${run}` }))
        .candidates,
    ).toEqual([]);
    expect(
      (await searchMemberCandidates(as.admin, { spaceId: ids.space, query: run })).candidates.map(
        (c) => c.userId,
      ),
    ).toEqual(expect.not.arrayContaining([ids.invitee, ids.otherGuest, ids.editor]));
  });

  it("adds, re-roles and removes internal members; the last admin stays", async () => {
    await expectCode(
      addMember(as.editor, { spaceId: ids.space, userId: ids.candidate, role: "viewer" }),
      "FORBIDDEN",
    );
    await expectCode(
      addMember(as.admin, { spaceId: ids.space, userId: ids.invitee, role: "viewer" }),
      "MEMBER_USER_NOT_FOUND",
    );
    const added = await addMember(as.admin, {
      spaceId: ids.space,
      userId: ids.candidate,
      role: "viewer",
    });
    expect(added).toMatchObject({
      userId: ids.candidate,
      role: "viewer",
      fullName: `Trần Ứng Viên ${run}`,
      addedBy: ids.admin,
      isGuest: false,
    });
    await expectCode(
      addMember(as.admin, { spaceId: ids.space, userId: ids.candidate, role: "viewer" }),
      "MEMBER_ALREADY_EXISTS",
    );

    expect(
      await changeMemberRole(as.admin, {
        spaceId: ids.space,
        userId: ids.candidate,
        role: "editor",
      }),
    ).toMatchObject({ role: "editor" });
    await expectCode(
      changeMemberRole(as.editor, { spaceId: ids.space, userId: ids.candidate, role: "admin" }),
      "FORBIDDEN",
    );
    await expectCode(
      changeMemberRole(as.outsider, { spaceId: ids.space, userId: ids.candidate, role: "admin" }),
      "SPACE_NOT_FOUND",
    );
    await expectCode(
      changeMemberRole(as.admin, { spaceId: ids.space, userId: ids.admin, role: "viewer" }),
      "SPACE_REQUIRES_ADMIN",
    );
    await expectCode(
      changeMemberRole(as.admin, { spaceId: ids.space, userId: ids.outsider, role: "viewer" }),
      "MEMBER_NOT_FOUND",
    );

    await expectCode(
      removeMember(as.viewer, { spaceId: ids.space, userId: ids.candidate }),
      "FORBIDDEN",
    );
    await leaveSpace(as.candidate, { spaceId: ids.space });
    await expectCode(
      removeMember(as.admin, { spaceId: ids.space, userId: ids.candidate }),
      "MEMBER_NOT_FOUND",
    );
    await expectCode(leaveSpace(as.admin, { spaceId: ids.space }), "SPACE_REQUIRES_ADMIN");
    await expectCode(leaveSpace(as.outsider, { spaceId: ids.space }), "SPACE_NOT_FOUND");

    const { rows } = await db.query(
      "select action from public.audit_logs where space_id = $1 and entity_id = $2 order by id",
      [ids.space, ids.candidate],
    );
    expect(rows.map((r: { action: string }) => r.action)).toEqual([
      "member.add",
      "member.role_change",
      "member.remove",
    ]);
  });

  it("invites a guest by email; the invitee accepts once and joins the Space", async () => {
    await expectCode(
      createInvitation(
        as.editor,
        { spaceId: ids.space, email: email("invitee"), role: "viewer" },
        deps,
      ),
      "FORBIDDEN",
    );
    await expectCode(
      createInvitation(
        as.admin,
        { spaceId: ids.space, email: email("viewer"), role: "viewer" },
        deps,
      ),
      "MEMBER_ALREADY_EXISTS",
    );

    const sent = await createInvitation(
      as.admin,
      { spaceId: ids.space, email: email("invitee").toUpperCase(), role: "editor" },
      deps,
    );
    expect(sent.invitation).toMatchObject({
      status: "pending",
      role: "editor",
      email: email("invitee"),
    });
    expect(sent.emailStatus).toBe(SMTP_HOST ? "sent" : "skipped");
    const token = await receivedToken(email("invitee"), sent.inviteUrl);
    expect(token).toBe(tokenOf(sent.inviteUrl));

    const { rows: stored } = await db.query(
      "select token_hash from public.invitations where id = $1",
      [sent.invitation.id],
    );
    expect(stored[0].token_hash).not.toContain(token);

    await expectCode(
      createInvitation(
        as.admin,
        { spaceId: ids.space, email: email("invitee"), role: "viewer" },
        deps,
      ),
      "INVITATION_ALREADY_PENDING",
    );
    expect(
      (await listInvitations(as.admin, { spaceId: ids.space })).invitations.map((i) => i.id),
    ).toContain(sent.invitation.id);
    expect((await listInvitations(as.editor, { spaceId: ids.space })).invitations).toEqual([]);

    // Someone else holding the link cannot use it.
    expect(await getInvitation(as.otherGuest, { token })).toMatchObject({ emailMatches: false });
    await expectCode(acceptInvitation(as.otherGuest, { token }), "INVITATION_EMAIL_MISMATCH");

    expect(await getInvitation(as.invitee, { token })).toMatchObject({
      spaceId: ids.space,
      spaceName: "Members test",
      role: "editor",
      status: "pending",
      emailMatches: true,
    });
    await expectCode(listMembers(as.invitee, { spaceId: ids.space }), "SPACE_NOT_FOUND");

    expect(await acceptInvitation(as.invitee, { token })).toEqual({
      spaceId: ids.space,
      spaceSlug: `mb-${run}`,
      role: "editor",
    });
    const { members } = await listMembers(as.invitee, { spaceId: ids.space });
    expect(members.find((m) => m.userId === ids.invitee)).toMatchObject({
      role: "editor",
      isGuest: true,
    });

    await expectCode(acceptInvitation(as.invitee, { token }), "INVITATION_ALREADY_USED");
    expect(await getInvitation(as.invitee, { token })).toMatchObject({ status: "accepted" });
    await expectCode(
      revokeInvitation(as.admin, { invitationId: sent.invitation.id }),
      "INVITATION_ALREADY_USED",
    );

    const { rows } = await db.query(
      "select action, actor_id from public.audit_logs where entity_id = $1 order by id",
      [sent.invitation.id],
    );
    expect(rows).toEqual([
      { action: "invitation.create", actor_id: ids.admin },
      { action: "invitation.accept", actor_id: ids.invitee },
    ]);
  });

  it("revoked and expired links fail with their own code; resend issues a fresh link", async () => {
    const first = await createInvitation(
      as.admin,
      { spaceId: ids.space, email: email("otherGuest"), role: "viewer" },
      { ...deps, mailer: null },
    );
    const revoked = await revokeInvitation(as.admin, { invitationId: first.invitation.id });
    expect(revoked.status).toBe("revoked");
    await expectCode(
      revokeInvitation(as.editor, { invitationId: first.invitation.id }),
      "INVITATION_NOT_FOUND",
    );
    await expectCode(
      acceptInvitation(as.otherGuest, { token: tokenOf(first.inviteUrl) }),
      "INVITATION_REVOKED",
    );

    const second = await createInvitation(
      as.admin,
      { spaceId: ids.space, email: email("otherGuest"), role: "viewer" },
      { ...deps, mailer: null },
    );
    await db.query(
      "update public.invitations set expires_at = now() - interval '1 minute' where id = $1",
      [second.invitation.id],
    );
    await expectCode(
      acceptInvitation(as.otherGuest, { token: tokenOf(second.inviteUrl) }),
      "INVITATION_EXPIRED",
    );
    expect(
      (await listInvitations(as.admin, { spaceId: ids.space })).invitations.find(
        (i) => i.id === second.invitation.id,
      ),
    ).toMatchObject({ status: "expired" });

    const resent = await resendInvitation(
      as.admin,
      { invitationId: second.invitation.id },
      { ...deps, mailer: null },
    );
    expect(resent.invitation.status).toBe("pending");
    await expectCode(
      acceptInvitation(as.otherGuest, { token: tokenOf(second.inviteUrl) }),
      "INVITATION_NOT_FOUND",
    );
    expect(
      await acceptInvitation(as.otherGuest, { token: tokenOf(resent.inviteUrl) }),
    ).toMatchObject({
      role: "viewer",
    });
  });
});
