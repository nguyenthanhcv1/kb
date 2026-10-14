// @vitest-environment happy-dom
import enCommon from "@kb/i18n/messages/en/common.json";
import enErrors from "@kb/i18n/messages/en/errors.json";
import enMembers from "@kb/i18n/messages/en/members.json";
import enNav from "@kb/i18n/messages/en/nav.json";
import enSpace from "@kb/i18n/messages/en/space.json";
import enTree from "@kb/i18n/messages/en/tree.json";
import viCommon from "@kb/i18n/messages/vi/common.json";
import viErrors from "@kb/i18n/messages/vi/errors.json";
import viMembers from "@kb/i18n/messages/vi/members.json";
import viNav from "@kb/i18n/messages/vi/nav.json";
import viSpace from "@kb/i18n/messages/vi/space.json";
import viTree from "@kb/i18n/messages/vi/tree.json";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { listPageSharesExample, type PageShare, type SharedPage } from "@/server/page-shares";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));

const shareActions = vi.hoisted(() => ({
  listPageSharesAction: vi.fn(),
  sharePageAction: vi.fn(),
  changePageShareRoleAction: vi.fn(),
  removePageShareAction: vi.fn(),
  leaveSharedPageAction: vi.fn(),
}));
vi.mock("@/server/page-shares/actions", () => shareActions);
vi.mock("@/server/members/actions", () => ({
  resendInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
}));
const pageActions = vi.hoisted(() => ({ listChildPagesAction: vi.fn() }));
vi.mock("@/server/pages/actions", () => pageActions);

const { SharePageDialogBody } = await import("./share-page-dialog");
const { SharedPagesNav } = await import("@/components/space/shared-pages-nav");
const { Dialog, DialogContent } = await import("@/components/ui/dialog");

const messages = {
  vi: {
    common: viCommon,
    errors: viErrors,
    members: viMembers,
    nav: viNav,
    space: viSpace,
    tree: viTree,
  },
  en: {
    common: enCommon,
    errors: enErrors,
    members: enMembers,
    nav: enNav,
    space: enSpace,
    tree: enTree,
  },
};

function renderWith(ui: ReactNode, locale: "vi" | "en" = "vi") {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Asia/Ho_Chi_Minh">
      {ui}
    </NextIntlClientProvider>,
  );
}

const PAGE = { id: "20000000-0000-4000-8000-000000000001", title: "Hợp đồng đối tác" };
const DIRECT = listPageSharesExample.shares[0]!;
const INHERITED: PageShare = {
  ...DIRECT,
  userId: "5d2f0000-0000-4000-8000-000000000009",
  email: "doitac@partner.vn",
  fullName: null,
  role: "editor",
  inherited: true,
  sourcePageId: "20000000-0000-4000-8000-000000000000",
  sourcePageTitle: "Đối tác",
};

function renderDialog(locale: "vi" | "en" = "vi") {
  return renderWith(
    <Dialog open>
      <DialogContent>
        <SharePageDialogBody page={PAGE} />
      </DialogContent>
    </Dialog>,
    locale,
  );
}

beforeAll(() => {
  // Radix Select measures pointer capture in happy-dom.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
  shareActions.listPageSharesAction.mockResolvedValue({
    ok: true,
    data: { shares: [DIRECT, INHERITED], invitations: [] },
  });
});
afterEach(cleanup);

describe("SharePageDialogBody", () => {
  it("lists direct shares with controls and inherited ones read-only", async () => {
    renderDialog();
    expect(screen.getByRole("heading", { name: "Chia sẻ “Hợp đồng đối tác”" })).toBeTruthy();
    const list = await screen.findByRole("list", { name: "Những người được chia sẻ" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Trần Khách")).toBeTruthy();
    expect(within(rows[0]!).getByText("Khách")).toBeTruthy();
    expect(
      within(rows[0]!).getByRole("button", { name: "Bỏ chia sẻ với Trần Khách" }),
    ).toBeTruthy();
    expect(within(rows[1]!).getByText("Được chia sẻ từ trang cha “Đối tác”")).toBeTruthy();
    expect(within(rows[1]!).queryByRole("button")).toBeNull();
    expect(shareActions.listPageSharesAction).toHaveBeenCalledWith({ pageId: PAGE.id });
  });

  it("shares with an existing account and reloads the list", async () => {
    shareActions.sharePageAction.mockResolvedValue({
      ok: true,
      data: { status: "granted", userId: DIRECT.userId, role: "viewer", emailStatus: "sent" },
    });
    renderDialog();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "Khach@Partner.vn");
    await user.click(screen.getByRole("button", { name: "Chia sẻ" }));
    expect(shareActions.sharePageAction).toHaveBeenCalledWith({
      pageId: PAGE.id,
      email: "Khach@Partner.vn",
      role: "viewer",
    });
    expect(await screen.findByText("Đã chia sẻ trang với khach@partner.vn.")).toBeTruthy();
    await waitFor(() => expect(shareActions.listPageSharesAction).toHaveBeenCalledTimes(2));
  });

  it("shows the invite link when the email has no account", async () => {
    shareActions.sharePageAction.mockResolvedValue({
      ok: true,
      data: {
        status: "invited",
        invitation: {},
        inviteUrl: "https://kb.example/invite/abc",
        emailStatus: "skipped",
      },
    });
    renderDialog("en");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "new@partner.vn");
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(await screen.findByDisplayValue("https://kb.example/invite/abc")).toBeTruthy();
  });

  it("validates the email before calling the server and translates errors", async () => {
    renderDialog();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Chia sẻ" }));
    expect(shareActions.sharePageAction).not.toHaveBeenCalled();

    shareActions.sharePageAction.mockResolvedValue({
      ok: false,
      error: "PAGE_SHARE_USER_INACTIVE",
    });
    await user.clear(screen.getByLabelText("Email"));
    await user.type(screen.getByLabelText("Email"), "locked@partner.vn");
    await user.click(screen.getByRole("button", { name: "Chia sẻ" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      viErrors.PAGE_SHARE_USER_INACTIVE,
    );
  });

  it("removes a direct share after confirmation", async () => {
    shareActions.removePageShareAction.mockResolvedValue({ ok: true, data: undefined });
    renderDialog();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Bỏ chia sẻ với Trần Khách" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Bỏ chia sẻ" }));
    expect(shareActions.removePageShareAction).toHaveBeenCalledWith({
      pageId: PAGE.id,
      userId: DIRECT.userId,
    });
    expect(await screen.findByText("Đã bỏ chia sẻ với Trần Khách.")).toBeTruthy();
  });
});

describe("SharedPagesNav", () => {
  const shared: SharedPage = {
    pageId: PAGE.id,
    shortId: "a1B2c3D4",
    slug: "hop-dong",
    title: PAGE.title,
    icon: null,
    spaceId: "0b9a0000-0000-4000-8000-000000000001",
    spaceSlug: "design",
    spaceName: "Design",
    spaceIcon: null,
    role: "viewer",
    sharedAt: "2026-10-14T02:00:00+00:00",
    hasChildren: true,
  };

  it("renders nothing when no page is shared", () => {
    const { container } = renderWith(<SharedPagesNav pages={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("links shared pages and loads subpages on demand", async () => {
    pageActions.listChildPagesAction.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "20000000-0000-4000-8000-000000000002",
          spaceId: shared.spaceId,
          parentId: PAGE.id,
          shortId: "b1B2c3D4",
          slug: "phu-luc",
          title: "Phụ lục",
          icon: null,
          position: "a0",
          lastEditedAt: "2026-10-14T02:00:00+00:00",
          deletedAt: null,
          hasChildren: false,
        },
      ],
    });
    renderWith(<SharedPagesNav pages={[shared]} />, "en");
    expect(screen.getByRole("heading", { name: "Shared with me" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Hợp đồng đối tác/ }).getAttribute("href")).toBe(
      "/s/design/p/hop-dong-a1B2c3D4",
    );
    const user = userEvent.setup();
    const toggle = screen.getByRole("button", { name: "Show subpages of Hợp đồng đối tác" });
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const child = await screen.findByRole("link", { name: "Phụ lục" });
    expect(child.getAttribute("href")).toBe("/s/design/p/phu-luc-b1B2c3D4");
    expect(pageActions.listChildPagesAction).toHaveBeenCalledWith({
      spaceId: shared.spaceId,
      parentId: PAGE.id,
    });
  });
});
