// @vitest-environment happy-dom
import enAdmin from "@kb/i18n/messages/en/admin.json";
import enAuth from "@kb/i18n/messages/en/auth.json";
import enCommon from "@kb/i18n/messages/en/common.json";
import enErrors from "@kb/i18n/messages/en/errors.json";
import enNav from "@kb/i18n/messages/en/nav.json";
import viAdmin from "@kb/i18n/messages/vi/admin.json";
import viAuth from "@kb/i18n/messages/vi/auth.json";
import viCommon from "@kb/i18n/messages/vi/common.json";
import viErrors from "@kb/i18n/messages/vi/errors.json";
import viNav from "@kb/i18n/messages/vi/nav.json";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  accessImpactExample,
  addAccessEntriesExample,
  listAccessEntriesExample,
  listUsersExample,
  type AdminUser,
} from "@/server/admin";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/admin/access",
}));

const actions = vi.hoisted(() => ({
  addAccessEntries: vi.fn(),
  previewAccessRemoval: vi.fn(),
  removeAccessEntries: vi.fn(),
  sendTestEmail: vi.fn(),
  setUserDeactivated: vi.fn(),
  setUserSuperAdmin: vi.fn(),
}));
vi.mock("@/server/admin/actions", () => actions);
vi.mock("@/server/auth", () => ({ signOut: vi.fn() }));

const { AccessEntryList } = await import("./access-entry-list");
const { AddAccessForm } = await import("./add-access-form");
const { AdminNav } = await import("./admin-nav");
const { TestEmailForm } = await import("./test-email-form");
const { UserList } = await import("./user-list");
const { UserMenu } = await import("@/components/layout/user-menu");

const messages = {
  vi: { admin: viAdmin, auth: viAuth, common: viCommon, errors: viErrors, nav: viNav },
  en: { admin: enAdmin, auth: enAuth, common: enCommon, errors: enErrors, nav: enNav },
};

function renderWith(ui: ReactNode, locale: "vi" | "en" = "vi") {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Asia/Ho_Chi_Minh">
      {ui}
    </NextIntlClientProvider>,
  );
}

const [domainEntry, selfEntry] = listAccessEntriesExample.entries as [
  (typeof listAccessEntriesExample.entries)[number],
  (typeof listAccessEntriesExample.entries)[number],
];
const [selfUser, guestUser] = listUsersExample.users as [AdminUser, AdminUser];
const internalUser: AdminUser = {
  ...guestUser,
  id: "5d2f0000-0000-4000-8000-000000000003",
  email: "an@ahamove.com",
  fullName: "An Nguyễn",
  isGuest: false,
  access: "allowlist",
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("AddAccessForm", () => {
  it("previews the parsed input and requires confirming public email domains", async () => {
    const user = userEvent.setup();
    renderWith(<AddAccessForm />);

    await user.type(
      screen.getByLabelText("Email hoặc tên miền"),
      "an@ahamove.com, gmail.com, nope, an@ahamove.com",
    );
    expect(
      screen.getByText("2 mục hợp lệ (1 email, 1 tên miền) · 1 không hợp lệ · 1 trùng"),
    ).toBeTruthy();
    expect(screen.getByText(/gmail\.com là tên miền email công cộng/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Thêm vào danh sách" }));
    expect(actions.addAccessEntries).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Hãy xác nhận trước khi thêm tên miền email công cộng, hoặc bỏ chúng khỏi danh sách.",
      ),
    ).toBeTruthy();

    actions.addAccessEntries.mockResolvedValue({ ok: true, data: addAccessEntriesExample });
    await user.click(screen.getByLabelText("Tôi hiểu, vẫn thêm tên miền email công cộng"));
    await user.type(screen.getByLabelText("Ghi chú (không bắt buộc)"), "Team Vận hành");
    await user.click(screen.getByRole("button", { name: "Thêm vào danh sách" }));

    expect(actions.addAccessEntries).toHaveBeenCalledWith({
      input: "an@ahamove.com, gmail.com, nope, an@ahamove.com",
      note: "Team Vận hành",
      allowPublicDomains: true,
    });
    const status = await screen.findByRole("status");
    expect(within(status).getByText(/Đã thêm 1 mục\./)).toBeTruthy();
    expect(within(status).getByText("Không thêm 2 mục:")).toBeTruthy();
    expect(
      within(status).getByText("gmail.com: Tên miền email công cộng — cần xác nhận"),
    ).toBeTruthy();
    expect(within(status).getByText("nope: Không hợp lệ")).toBeTruthy();
    expect(router.refresh).toHaveBeenCalled();
  });

  it("blocks empty input and shows translated server errors (en)", async () => {
    const user = userEvent.setup();
    renderWith(<AddAccessForm />, "en");

    await user.click(screen.getByRole("button", { name: "Add to the allowlist" }));
    expect(screen.getByText("Enter at least one valid email or domain.")).toBeTruthy();

    actions.addAccessEntries.mockResolvedValue({ ok: false, error: "FORBIDDEN" });
    await user.type(screen.getByLabelText("Emails or domains"), "ahamove.com");
    await user.click(screen.getByRole("button", { name: "Add to the allowlist" }));
    expect(await screen.findByText("You do not have permission to do this.")).toBeTruthy();
  });
});

describe("AccessEntryList", () => {
  it("lists entries and disables removing your own email", () => {
    renderWith(<AccessEntryList entries={listAccessEntriesExample.entries} />);

    expect(screen.getByText("ahamove.com")).toBeTruthy();
    expect(screen.getByText("Cả công ty")).toBeTruthy();
    expect(screen.getByText(/42 người dùng/)).toBeTruthy();
    const selfButton = screen.getByRole("button", {
      name: `Gỡ ${selfEntry.value} khỏi danh sách cho phép`,
    }) as HTMLButtonElement;
    expect(selfButton.disabled).toBe(true);
    expect(selfButton.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText("Bạn không thể gỡ email của chính mình.")).toBeTruthy();
  });

  it("shows who is affected before removing, then removes", async () => {
    const user = userEvent.setup();
    actions.previewAccessRemoval.mockResolvedValue({ ok: true, data: accessImpactExample });
    actions.removeAccessEntries.mockResolvedValue({
      ok: true,
      data: { removed: 1, impact: accessImpactExample },
    });
    renderWith(<AccessEntryList entries={listAccessEntriesExample.entries} />);

    await user.click(
      screen.getByRole("button", { name: `Gỡ ${domainEntry.value} khỏi danh sách cho phép` }),
    );
    const dialog = await screen.findByRole("alertdialog", { name: "Gỡ ahamove.com?" });
    expect(actions.previewAccessRemoval).toHaveBeenCalledWith({ ids: [domainEntry.id] });
    expect(
      await within(dialog).findByText("12 người dùng đang hoạt động khớp mục này."),
    ).toBeTruthy();
    expect(within(dialog).getByText("3 người sẽ mất quyền truy cập.")).toBeTruthy();
    expect(
      within(dialog).getByText("1 người sẽ thành khách mời (vẫn là thành viên Space)."),
    ).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "Gỡ khỏi danh sách" }));
    expect(actions.removeAccessEntries).toHaveBeenCalledWith({ ids: [domainEntry.id] });
    expect(await screen.findByText("Đã gỡ ahamove.com khỏi danh sách cho phép.")).toBeTruthy();
    expect(router.refresh).toHaveBeenCalled();
  });

  it("shows the translated error when the server refuses", async () => {
    const user = userEvent.setup();
    actions.previewAccessRemoval.mockResolvedValue({ ok: true, data: accessImpactExample });
    actions.removeAccessEntries.mockResolvedValue({
      ok: false,
      error: "ACCESS_CANNOT_REMOVE_SELF",
    });
    renderWith(<AccessEntryList entries={[{ ...domainEntry }]} />, "en");

    await user.click(screen.getByRole("button", { name: "Remove ahamove.com from the allowlist" }));
    const dialog = await screen.findByRole("alertdialog");
    await within(dialog).findByText("12 active users match this entry.");
    await user.click(within(dialog).getByRole("button", { name: "Remove from the allowlist" }));
    expect(
      await within(dialog).findByText("You cannot remove your own email from the allowlist."),
    ).toBeTruthy();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("has an empty state", () => {
    renderWith(<AccessEntryList entries={[]} />, "en");
    expect(screen.getByText("The allowlist is empty: only super admins can sign in.")).toBeTruthy();
  });
});

describe("TestEmailForm", () => {
  it("validates the recipient and sends to yourself by default", async () => {
    const user = userEvent.setup();
    actions.sendTestEmail.mockResolvedValue({ ok: true, data: { to: "me@ahamove.com" } });
    renderWith(<TestEmailForm defaultRecipient="me@ahamove.com" />);

    await user.type(screen.getByLabelText("Người nhận"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Gửi email thử" }));
    expect(screen.getByText("Email người nhận không hợp lệ.")).toBeTruthy();
    expect(actions.sendTestEmail).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Người nhận"));
    await user.click(screen.getByRole("button", { name: "Gửi email thử" }));
    expect(actions.sendTestEmail).toHaveBeenCalledWith({});
    expect(await screen.findByText("Đã gửi email thử tới me@ahamove.com.")).toBeTruthy();
  });

  it("shows the translated SMTP error", async () => {
    const user = userEvent.setup();
    actions.sendTestEmail.mockResolvedValue({ ok: false, error: "MAIL_NOT_CONFIGURED" });
    renderWith(<TestEmailForm defaultRecipient="me@ahamove.com" />, "en");

    await user.type(screen.getByLabelText("Recipient"), "an@ahamove.com");
    await user.click(screen.getByRole("button", { name: "Send test email" }));
    expect(actions.sendTestEmail).toHaveBeenCalledWith({ to: "an@ahamove.com" });
    expect(await screen.findByText("Email sending (SMTP) is not configured.")).toBeTruthy();
  });
});

describe("UserList", () => {
  it("shows badges, access reason and disables self-changes", async () => {
    const user = userEvent.setup();
    renderWith(<UserList users={[selfUser, guestUser]} />);

    expect(screen.getByText("Nguyễn Thành")).toBeTruthy();
    expect(screen.getByText("Bạn")).toBeTruthy();
    expect(screen.getByText("Khách mời")).toBeTruthy();
    expect(screen.getByText(/Chỉ qua thành viên Space · 1 Space · Chưa đăng nhập/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Thao tác với Nguyễn Thành" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu).getByRole("menuitem", { name: "Khoá tài khoản" }).getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      within(menu)
        .getByRole("menuitem", { name: "Gỡ quyền quản trị viên hệ thống" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      within(menu).getByText("Bạn không thể khoá hoặc gỡ quyền quản trị của chính mình."),
    ).toBeTruthy();
  });

  it("locks a user after confirmation", async () => {
    const user = userEvent.setup();
    actions.setUserDeactivated.mockResolvedValue({
      ok: true,
      data: { ...internalUser, deactivatedAt: "2026-09-27T03:00:00+00:00", access: "deactivated" },
    });
    renderWith(<UserList users={[internalUser]} />);

    await user.click(screen.getByRole("button", { name: "Thao tác với An Nguyễn" }));
    await user.click(await screen.findByRole("menuitem", { name: "Khoá tài khoản" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Khoá An Nguyễn?" });
    await user.click(within(dialog).getByRole("button", { name: "Khoá tài khoản" }));

    expect(actions.setUserDeactivated).toHaveBeenCalledWith({
      userId: internalUser.id,
      deactivated: true,
    });
    expect(await screen.findByText("Đã khoá An Nguyễn.")).toBeTruthy();
    expect(router.refresh).toHaveBeenCalled();
  });

  it("shows the translated error when granting super admin fails", async () => {
    const user = userEvent.setup();
    actions.setUserSuperAdmin.mockResolvedValue({ ok: false, error: "LAST_SUPER_ADMIN" });
    renderWith(<UserList users={[internalUser]} />, "en");

    await user.click(screen.getByRole("button", { name: "Actions for An Nguyễn" }));
    await user.click(await screen.findByRole("menuitem", { name: "Make super admin" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Make An Nguyễn a super admin?",
    });
    await user.click(within(dialog).getByRole("button", { name: "Make super admin" }));

    expect(actions.setUserSuperAdmin).toHaveBeenCalledWith({
      userId: internalUser.id,
      superAdmin: true,
    });
    expect(
      await within(dialog).findByText("At least one active super admin must remain."),
    ).toBeTruthy();
  });

  it("has an empty state", () => {
    renderWith(<UserList users={[]} />, "en");
    expect(screen.getByText("No users match.")).toBeTruthy();
  });
});

describe("AdminNav", () => {
  it("marks the current section", () => {
    renderWith(<AdminNav />);
    expect(screen.getByRole("link", { name: "Truy cập" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "Người dùng" }).getAttribute("href")).toBe(
      "/admin/users",
    );
  });
});

describe("UserMenu admin entry", () => {
  const base = {
    id: "u1",
    email: "an@ahamove.com",
    displayName: "An",
    avatarUrl: null,
    isGuest: false,
  };

  it("links super admins to Administration", async () => {
    const user = userEvent.setup();
    renderWith(<UserMenu user={{ ...base, isSuperAdmin: true }} />);
    await user.click(screen.getByRole("button", { name: "Mở menu tài khoản" }));
    const link = await screen.findByRole("menuitem", { name: "Quản trị" });
    expect(link.getAttribute("href")).toBe("/admin/access");
  });

  it("hides it from everyone else", async () => {
    const user = userEvent.setup();
    renderWith(<UserMenu user={{ ...base, isSuperAdmin: false }} />);
    await user.click(screen.getByRole("button", { name: "Mở menu tài khoản" }));
    await screen.findByRole("menu");
    expect(screen.queryByRole("menuitem", { name: "Quản trị" })).toBeNull();
  });
});
