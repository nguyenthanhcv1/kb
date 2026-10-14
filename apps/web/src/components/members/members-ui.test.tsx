// @vitest-environment happy-dom
import enCommon from "@kb/i18n/messages/en/common.json";
import enErrors from "@kb/i18n/messages/en/errors.json";
import enMembers from "@kb/i18n/messages/en/members.json";
import enSpace from "@kb/i18n/messages/en/space.json";
import viCommon from "@kb/i18n/messages/vi/common.json";
import viErrors from "@kb/i18n/messages/vi/errors.json";
import viMembers from "@kb/i18n/messages/vi/members.json";
import viSpace from "@kb/i18n/messages/vi/space.json";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  invitationPreviewExample,
  listInvitationsExample,
  listMembersExample,
  listSpaceGroupsExample,
  searchGrantableGroupsExample,
  searchMemberCandidatesExample,
  type SpaceGroup,
  type SpaceMember,
} from "@/server/members";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));

const actions = vi.hoisted(() => ({
  searchMemberCandidates: vi.fn(),
  addMember: vi.fn(),
  changeMemberRole: vi.fn(),
  removeMember: vi.fn(),
  leaveSpace: vi.fn(),
  createInvitation: vi.fn(),
  resendInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  acceptInvitation: vi.fn(),
  searchGrantableGroups: vi.fn(),
  addSpaceGroup: vi.fn(),
  changeSpaceGroupRole: vi.fn(),
  removeSpaceGroup: vi.fn(),
}));
vi.mock("@/server/members/actions", () => actions);

const { MembersSettings } = await import("./members-settings");
const { AcceptInvitationButton } = await import("./accept-invitation-button");
const { InvitationList } = await import("./invitation-list");
const { InviteGuestForm } = await import("./invite-guest-form");
const { AddMemberForm } = await import("./add-member-form");
const { GroupAccessSettings } = await import("./group-access");

const messages = {
  vi: { common: viCommon, errors: viErrors, members: viMembers, space: viSpace },
  en: { common: enCommon, errors: enErrors, members: enMembers, space: enSpace },
};

function renderWith(ui: ReactNode, locale: "vi" | "en" = "vi") {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Asia/Ho_Chi_Minh">
      {ui}
    </NextIntlClientProvider>,
  );
}

const SPACE = { id: "0b9a0000-0000-4000-8000-000000000001", name: "Design" };
const [ADMIN, GUEST] = listMembersExample.members as [SpaceMember, SpaceMember];
const EDITOR: SpaceMember = {
  ...ADMIN,
  userId: "5d2f0000-0000-4000-8000-000000000005",
  role: "editor",
  fullName: "Phạm Dung",
  email: "dung@thanhgo.com",
};
const INVITATION = listInvitationsExample.invitations[0]!;
const notify = () => ({ success: vi.fn(), error: vi.fn() });

beforeAll(() => {
  // Radix Select relies on pointer capture and scrollIntoView, which happy-dom lacks.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function renderSettings(locale: "vi" | "en" = "vi") {
  return renderWith(
    <MembersSettings
      space={SPACE}
      members={[GUEST, EDITOR, ADMIN]}
      groups={listSpaceGroupsExample.groups}
      invitations={listInvitationsExample.invitations}
      currentUserId={ADMIN.userId}
    />,
    locale,
  );
}

describe("MembersSettings", () => {
  it("lists admins first, marks the caller and guests, and offers leave on the own row", () => {
    renderSettings();
    const list = screen.getByRole("list", { name: viMembers.list.title });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Nguyễn An"),
      expect.stringContaining("Phạm Dung"),
      expect.stringContaining("Trần Khách"),
    ]);
    expect(within(rows[0]!).getByText(viMembers.list.you)).toBeTruthy();
    expect(within(rows[0]!).getByRole("button", { name: viMembers.leave.action })).toBeTruthy();
    expect(within(rows[2]!).getByText(viMembers.list.guest)).toBeTruthy();
    expect(
      within(rows[2]!).getByRole("button", { name: "Xoá Trần Khách khỏi không gian" }),
    ).toBeTruthy();
    expect(screen.getByText("3 thành viên")).toBeTruthy();
  });

  it("renders in English", () => {
    renderSettings("en");
    expect(screen.getByRole("heading", { name: /Members/ })).toBeTruthy();
    expect(screen.getByText("3 members")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Role of Phạm Dung" }).textContent).toContain(
      enSpace.roles.editor,
    );
    expect(screen.getByText(/Expires/)).toBeTruthy();
  });

  it("changes a role and reports it; never offers admin to a guest", async () => {
    const user = userEvent.setup();
    actions.changeMemberRole.mockResolvedValue({ ok: true, data: { ...EDITOR, role: "viewer" } });
    renderSettings();

    await user.click(screen.getByRole("combobox", { name: "Vai trò của Trần Khách" }));
    let options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining(viSpace.roles.viewer),
      expect.stringContaining(viSpace.roles.editor),
    ]);
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("combobox", { name: "Vai trò của Phạm Dung" }));
    options = await screen.findAllByRole("option");
    expect(options).toHaveLength(3);
    await user.click(options[0]!);
    expect(actions.changeMemberRole).toHaveBeenCalledWith({
      spaceId: SPACE.id,
      userId: EDITOR.userId,
      role: "viewer",
    });
    expect(await screen.findByText("Đã đổi vai trò của Phạm Dung thành “Xem”.")).toBeTruthy();
    expect(router.refresh).toHaveBeenCalled();
  });

  it("reverts the role and shows the translated error when the DB refuses", async () => {
    const user = userEvent.setup();
    actions.changeMemberRole.mockResolvedValue({ ok: false, error: "SPACE_REQUIRES_ADMIN" });
    renderSettings();
    const trigger = screen.getByRole("combobox", { name: "Vai trò của Nguyễn An" });
    await user.click(trigger);
    await user.click((await screen.findAllByRole("option"))[0]!);
    expect((await screen.findByRole("alert")).textContent).toContain(viErrors.SPACE_REQUIRES_ADMIN);
    expect(trigger.textContent).toContain(viSpace.roles.admin);
  });

  it("removes a member after confirmation; errors stay in the dialog", async () => {
    const user = userEvent.setup();
    actions.removeMember
      .mockResolvedValueOnce({ ok: false, error: "FORBIDDEN" })
      .mockResolvedValueOnce({ ok: true, data: undefined });
    renderSettings();
    await user.click(screen.getByRole("button", { name: "Xoá Phạm Dung khỏi không gian" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Phạm Dung");
    expect(dialog.textContent).toContain("Design");

    await user.click(within(dialog).getByRole("button", { name: viMembers.list.remove }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(viErrors.FORBIDDEN);

    // The error can render before the pending transition settles; wait for the idle label.
    await user.click(await within(dialog).findByRole("button", { name: viMembers.list.remove }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(actions.removeMember).toHaveBeenLastCalledWith({
      spaceId: SPACE.id,
      userId: EDITOR.userId,
    });
    expect(screen.getByText("Đã xoá Phạm Dung khỏi không gian.")).toBeTruthy();
  });

  it("leaves the Space and goes back to the list", async () => {
    const user = userEvent.setup();
    actions.leaveSpace.mockResolvedValue({ ok: true, data: undefined });
    renderSettings();
    await user.click(screen.getByRole("button", { name: viMembers.leave.action }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: viMembers.leave.confirm }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/"));
    expect(actions.leaveSpace).toHaveBeenCalledWith({ spaceId: SPACE.id });
  });
});

describe("GroupAccessSettings", () => {
  const KAS = listSpaceGroupsExample.groups[0] as SpaceGroup;
  const FOUND = searchGrantableGroupsExample.groups[0]!;

  it("is part of the members settings, with the groups and their role", () => {
    renderSettings();
    const list = screen.getByRole("list", { name: viMembers.groups.title });
    expect(within(list).getByText("KAS")).toBeTruthy();
    expect(within(list).getByText(/12 thành viên/)).toBeTruthy();
    expect(
      within(list).getByRole("combobox", { name: "Quyền của nhóm KAS" }).textContent,
    ).toContain(viSpace.roles.editor);
  });

  it("shows an empty state in English", () => {
    renderWith(<GroupAccessSettings space={SPACE} groups={[]} />, "en");
    expect(screen.getByRole("heading", { name: /Groups with access/ })).toBeTruthy();
    expect(screen.getByText(enMembers.groups.empty)).toBeTruthy();
  });

  it("searches groups and grants one as viewer by default; admin is never offered", async () => {
    const user = userEvent.setup();
    actions.searchGrantableGroups.mockResolvedValue({
      ok: true,
      data: searchGrantableGroupsExample,
    });
    actions.addSpaceGroup.mockResolvedValue({ ok: true, data: { ...FOUND, role: "viewer" } });
    renderWith(<GroupAccessSettings space={SPACE} groups={[]} />);

    await user.click(screen.getByRole("combobox", { name: viMembers.groups.roleLabel }));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining(viSpace.roles.viewer),
      expect.stringContaining(viSpace.roles.editor),
    ]);
    await user.keyboard("{Escape}");

    await user.type(screen.getByLabelText(viMembers.groups.searchLabel), "ke toan");
    const add = await screen.findByRole("button", { name: "Cấp quyền cho nhóm Kế toán" });
    expect(actions.searchGrantableGroups).toHaveBeenCalledWith({
      spaceId: SPACE.id,
      query: "ke toan",
    });
    await user.click(add);
    await waitFor(() =>
      expect(actions.addSpaceGroup).toHaveBeenCalledWith({
        spaceId: SPACE.id,
        groupId: FOUND.groupId,
        role: "viewer",
      }),
    );
    expect(await screen.findByText("Đã cấp quyền cho nhóm Kế toán.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cấp quyền cho nhóm Kế toán" })).toBeNull();
    expect(router.refresh).toHaveBeenCalled();
  });

  it("shows a translated error when granting fails", async () => {
    const user = userEvent.setup();
    actions.searchGrantableGroups.mockResolvedValue({
      ok: true,
      data: searchGrantableGroupsExample,
    });
    actions.addSpaceGroup.mockResolvedValue({ ok: false, error: "SPACE_GROUP_ALREADY_EXISTS" });
    renderWith(<GroupAccessSettings space={SPACE} groups={[]} />);
    await user.type(screen.getByLabelText(viMembers.groups.searchLabel), "ke");
    await user.click(await screen.findByRole("button", { name: "Cấp quyền cho nhóm Kế toán" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      viErrors.SPACE_GROUP_ALREADY_EXISTS,
    );
  });

  it("changes the role of a group, reverting on error", async () => {
    const user = userEvent.setup();
    actions.changeSpaceGroupRole
      .mockResolvedValueOnce({ ok: false, error: "FORBIDDEN" })
      .mockResolvedValueOnce({ ok: true, data: { ...KAS, role: "viewer" } });
    renderWith(<GroupAccessSettings space={SPACE} groups={[KAS]} />);
    const trigger = screen.getByRole("combobox", { name: "Quyền của nhóm KAS" });

    await user.click(trigger);
    await user.click((await screen.findAllByRole("option"))[0]!);
    expect((await screen.findByRole("alert")).textContent).toContain(viErrors.FORBIDDEN);
    await waitFor(() => expect(trigger.textContent).toContain(viSpace.roles.editor));

    await user.click(trigger);
    await user.click((await screen.findAllByRole("option"))[0]!);
    expect(actions.changeSpaceGroupRole).toHaveBeenLastCalledWith({
      spaceId: SPACE.id,
      groupId: KAS.groupId,
      role: "viewer",
    });
    expect(await screen.findByText("Đã đổi quyền của nhóm KAS thành “Xem”.")).toBeTruthy();
  });

  it("removes a group's access after confirmation; a grant already gone counts as removed", async () => {
    const user = userEvent.setup();
    actions.removeSpaceGroup.mockResolvedValue({ ok: false, error: "SPACE_GROUP_NOT_FOUND" });
    renderWith(<GroupAccessSettings space={SPACE} groups={[KAS]} />);
    await user.click(screen.getByRole("button", { name: "Gỡ quyền của nhóm KAS" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("KAS");
    expect(dialog.textContent).toContain("Design");
    await user.click(within(dialog).getByRole("button", { name: viMembers.groups.remove }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(actions.removeSpaceGroup).toHaveBeenCalledWith({
      spaceId: SPACE.id,
      groupId: KAS.groupId,
    });
    expect(screen.getByText("Đã gỡ quyền của nhóm KAS.")).toBeTruthy();
  });
});

describe("AddMemberForm", () => {
  it("searches after typing and adds the candidate with the chosen role", async () => {
    const user = userEvent.setup();
    actions.searchMemberCandidates.mockResolvedValue({
      ok: true,
      data: searchMemberCandidatesExample,
    });
    actions.addMember.mockResolvedValue({ ok: true, data: EDITOR });
    const n = notify();
    renderWith(<AddMemberForm spaceId={SPACE.id} notify={n} />);

    await user.type(screen.getByLabelText(viMembers.add.searchLabel), "binh");
    const add = await screen.findByRole("button", { name: "Thêm Lê Bình" });
    // Debounced: one request for the whole word.
    expect(actions.searchMemberCandidates).toHaveBeenCalledTimes(1);
    expect(actions.searchMemberCandidates).toHaveBeenCalledWith({
      spaceId: SPACE.id,
      query: "binh",
    });

    await user.click(screen.getByRole("combobox", { name: viMembers.add.roleLabel }));
    await user.click(await screen.findByRole("option", { name: /Quản trị/ }));
    await user.click(add);
    await waitFor(() =>
      expect(actions.addMember).toHaveBeenCalledWith({
        spaceId: SPACE.id,
        userId: searchMemberCandidatesExample.candidates[0]!.userId,
        role: "admin",
      }),
    );
    expect(n.success).toHaveBeenCalledWith("Đã thêm Lê Bình vào không gian.");
    expect(screen.queryByRole("button", { name: "Thêm Lê Bình" })).toBeNull();
  });

  it("says when nobody matches", async () => {
    const user = userEvent.setup();
    actions.searchMemberCandidates.mockResolvedValue({ ok: true, data: { candidates: [] } });
    renderWith(<AddMemberForm spaceId={SPACE.id} notify={notify()} />, "en");
    await user.type(screen.getByLabelText(enMembers.add.searchLabel), "zz");
    expect(await screen.findByText(enMembers.add.noResults)).toBeTruthy();
  });
});

describe("InviteGuestForm", () => {
  it("validates the email before calling the server", async () => {
    const user = userEvent.setup();
    renderWith(<InviteGuestForm spaceId={SPACE.id} />);
    await user.type(screen.getByLabelText(viMembers.invite.emailLabel), "khach@");
    await user.click(screen.getByRole("button", { name: viMembers.invite.submit }));
    expect(screen.getByText(viMembers.invite.emailInvalid)).toBeTruthy();
    expect(screen.getByLabelText(viMembers.invite.emailLabel).getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(actions.createInvitation).not.toHaveBeenCalled();
  });

  it("invites as viewer by default and shows the link when email was skipped", async () => {
    const user = userEvent.setup();
    actions.createInvitation.mockResolvedValue({
      ok: true,
      data: {
        invitation: { ...INVITATION, email: "khach@partner.vn", role: "viewer" },
        inviteUrl: "https://kb.example.com/invite/tok_123",
        emailStatus: "skipped",
      },
    });
    renderWith(<InviteGuestForm spaceId={SPACE.id} />);
    await user.type(screen.getByLabelText(viMembers.invite.emailLabel), "khach@partner.vn");
    await user.click(screen.getByRole("button", { name: viMembers.invite.submit }));
    expect(actions.createInvitation).toHaveBeenCalledWith({
      spaceId: SPACE.id,
      email: "khach@partner.vn",
      role: "viewer",
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "máy chủ chưa cấu hình gửi email",
    );
    expect((screen.getByLabelText(viMembers.invite.linkLabel) as HTMLInputElement).value).toBe(
      "https://kb.example.com/invite/tok_123",
    );
    expect((screen.getByLabelText(viMembers.invite.emailLabel) as HTMLInputElement).value).toBe("");
  });

  it("shows a translated server error", async () => {
    const user = userEvent.setup();
    actions.createInvitation.mockResolvedValue({ ok: false, error: "INVITATION_ALREADY_PENDING" });
    renderWith(<InviteGuestForm spaceId={SPACE.id} />, "en");
    await user.type(screen.getByLabelText(enMembers.invite.emailLabel), "doitac@partner.vn");
    await user.click(screen.getByRole("button", { name: enMembers.invite.submit }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      enErrors.INVITATION_ALREADY_PENDING,
    );
  });
});

describe("InvitationList", () => {
  it("shows an empty state", () => {
    renderWith(<InvitationList invitations={[]} />);
    expect(screen.getByText(viMembers.invitations.empty)).toBeTruthy();
  });

  it("marks expired invitations", () => {
    renderWith(<InvitationList invitations={[{ ...INVITATION, status: "expired" }]} />, "en");
    expect(screen.getByText(enMembers.invitations.status.expired)).toBeTruthy();
    expect(screen.getByText(/Expired Oct/)).toBeTruthy();
  });

  it("resends (new link shown) and revokes after confirmation", async () => {
    const user = userEvent.setup();
    actions.resendInvitation.mockResolvedValue({
      ok: true,
      data: { invitation: INVITATION, inviteUrl: "https://kb/invite/new", emailStatus: "sent" },
    });
    actions.revokeInvitation.mockResolvedValue({
      ok: true,
      data: { ...INVITATION, status: "revoked" },
    });
    renderWith(<InvitationList invitations={[INVITATION]} />);

    await user.click(screen.getByRole("button", { name: "Gửi lại lời mời cho doitac@partner.vn" }));
    expect(
      await screen.findByText(
        "Đã gửi lại lời mời tới doitac@partner.vn. Liên kết cũ không còn dùng được.",
      ),
    ).toBeTruthy();
    expect((screen.getByLabelText(viMembers.invite.linkLabel) as HTMLInputElement).value).toBe(
      "https://kb/invite/new",
    );

    await user.click(screen.getByRole("button", { name: "Thu hồi lời mời của doitac@partner.vn" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: viMembers.invitations.revoke }));
    await waitFor(() =>
      expect(actions.revokeInvitation).toHaveBeenCalledWith({ invitationId: INVITATION.id }),
    );
    expect(await screen.findByText("Đã thu hồi lời mời của doitac@partner.vn.")).toBeTruthy();
  });
});

describe("AcceptInvitationButton", () => {
  it("accepts and opens the Space", async () => {
    const user = userEvent.setup();
    actions.acceptInvitation.mockResolvedValue({
      ok: true,
      data: { spaceId: SPACE.id, spaceSlug: invitationPreviewExample.spaceSlug, role: "editor" },
    });
    renderWith(<AcceptInvitationButton token="tok_123" />);
    await user.click(screen.getByRole("button", { name: viMembers.invitePage.accept }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/s/design"));
    expect(actions.acceptInvitation).toHaveBeenCalledWith({ token: "tok_123" });
  });

  it("explains why accepting failed", async () => {
    const user = userEvent.setup();
    actions.acceptInvitation.mockResolvedValue({ ok: false, error: "INVITATION_EXPIRED" });
    renderWith(<AcceptInvitationButton token="tok_123" />, "en");
    await user.click(screen.getByRole("button", { name: enMembers.invitePage.accept }));
    expect((await screen.findByRole("alert")).textContent).toBe(enErrors.INVITATION_EXPIRED);
    expect(router.push).not.toHaveBeenCalled();
  });
});
