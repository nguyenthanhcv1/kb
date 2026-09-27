// @vitest-environment happy-dom
import enCommon from "@kb/i18n/messages/en/common.json";
import enErrors from "@kb/i18n/messages/en/errors.json";
import enNav from "@kb/i18n/messages/en/nav.json";
import enSpace from "@kb/i18n/messages/en/space.json";
import viCommon from "@kb/i18n/messages/vi/common.json";
import viErrors from "@kb/i18n/messages/vi/errors.json";
import viNav from "@kb/i18n/messages/vi/nav.json";
import viSpace from "@kb/i18n/messages/vi/space.json";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Space, SpaceRole } from "@/server/space";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
let pathname = "/";
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => pathname,
}));

const actions = vi.hoisted(() => ({
  createSpace: vi.fn(),
  updateSpace: vi.fn(),
  archiveSpace: vi.fn(),
}));
vi.mock("@/server/space/actions", () => actions);

const { ArchiveSpaceSection } = await import("./archive-space-section");
const { CreateSpaceDialog } = await import("./create-space-dialog");
const { SpaceHeader } = await import("./space-header");
const { SpaceList } = await import("./space-list");
const { SpaceNav } = await import("./space-nav");
const { SpaceSettingsForm } = await import("./space-settings-form");

const messages = {
  vi: { common: viCommon, errors: viErrors, nav: viNav, space: viSpace },
  en: { common: enCommon, errors: enErrors, nav: enNav, space: enSpace },
};

function renderWith(ui: ReactNode, locale: "vi" | "en" = "vi") {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Asia/Ho_Chi_Minh">
      {ui}
    </NextIntlClientProvider>,
  );
}

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: "0b9a0000-0000-4000-8000-000000000001",
    slug: "design",
    name: "Design",
    description: "Tài liệu của nhóm Design",
    icon: "🎨",
    visibility: "restricted",
    aiEnabled: true,
    createdBy: "5d2f0000-0000-4000-8000-000000000002",
    createdAt: "2026-09-01T02:00:00+00:00",
    updatedAt: "2026-09-01T02:00:00+00:00",
    role: "admin",
    ...overrides,
  };
}

beforeEach(() => {
  pathname = "/";
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("SpaceList", () => {
  it("lists Spaces with translated visibility and role, and the create button for internal users", () => {
    renderWith(
      <SpaceList
        spaces={[
          makeSpace(),
          makeSpace({
            id: "0b9a0000-0000-4000-8000-000000000002",
            slug: "hr",
            name: "HR",
            visibility: "internal",
            role: "viewer",
          }),
        ]}
        canCreate
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/s/design", "/s/hr"]);
    expect(within(links[1]!).getByText(viSpace.visibility.internal)).toBeTruthy();
    expect(within(links[1]!).getByText("Vai trò của bạn: Xem")).toBeTruthy();
    expect(screen.getByRole("button", { name: viSpace.create })).toBeTruthy();
  });

  it("hides the create button from guests and explains the empty list", () => {
    renderWith(<SpaceList spaces={[]} canCreate={false} />, "en");
    expect(screen.queryByRole("button", { name: enSpace.create })).toBeNull();
    expect(screen.getByText(enSpace.list.emptyGuest)).toBeTruthy();
  });
});

describe("SpaceNav", () => {
  it("marks the current Space and hides create for guests", () => {
    pathname = "/s/design/settings";
    renderWith(
      <SpaceNav
        spaces={[
          makeSpace(),
          makeSpace({
            id: "0b9a0000-0000-4000-8000-000000000002",
            slug: "design-2",
            name: "Design 2",
          }),
        ]}
        canCreate={false}
      />,
    );
    expect(screen.getByRole("link", { name: "Design" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Design 2" }).getAttribute("aria-current")).toBeNull();
    expect(screen.queryByRole("button", { name: viSpace.create })).toBeNull();
  });

  it.each([
    ["admin", true],
    ["editor", true],
    ["viewer", false],
  ] as [SpaceRole, boolean][])(
    "role %s sees the trash link of the current Space: %s",
    (role, visible) => {
      pathname = "/s/design/trash";
      renderWith(
        <SpaceNav
          spaces={[
            makeSpace({ role }),
            makeSpace({ id: "0b9a0000-0000-4000-8000-000000000002", slug: "other", name: "Other" }),
          ]}
          canCreate
        />,
      );
      const links = screen.queryAllByRole("link", { name: viNav.trash });
      // Only under the current Space.
      expect(links).toHaveLength(visible ? 1 : 0);
      if (visible) {
        expect(links[0]!.getAttribute("href")).toBe("/s/design/trash");
        expect(links[0]!.getAttribute("aria-current")).toBe("page");
      }
    },
  );
});

describe("SpaceHeader", () => {
  it.each([
    ["admin", true],
    ["editor", false],
    ["viewer", false],
  ] as [SpaceRole, boolean][])("role %s sees the settings link: %s", (role, visible) => {
    renderWith(<SpaceHeader space={makeSpace({ role })} />);
    const link = screen.queryByRole("link", { name: viSpace.settings });
    expect(Boolean(link)).toBe(visible);
    if (link) expect(link.getAttribute("href")).toBe("/s/design/settings");
  });

  it.each([
    ["admin", true],
    ["editor", true],
    ["viewer", false],
  ] as [SpaceRole, boolean][])("role %s sees the trash link: %s", (role, visible) => {
    renderWith(<SpaceHeader space={makeSpace({ role })} />, "en");
    const link = screen.queryByRole("link", { name: enNav.trash });
    expect(Boolean(link)).toBe(visible);
    if (link) expect(link.getAttribute("href")).toBe("/s/design/trash");
  });
});

describe("CreateSpaceDialog", () => {
  async function open() {
    const user = userEvent.setup();
    renderWith(<CreateSpaceDialog />);
    await user.click(screen.getByRole("button", { name: viSpace.create }));
    const dialog = await screen.findByRole("dialog");
    return { user, dialog };
  }

  it("derives the slug from the name until the slug is edited", async () => {
    const { user, dialog } = await open();
    const name = within(dialog).getByLabelText(viSpace.form.name);
    const slug = within(dialog).getByLabelText(viSpace.form.slug) as HTMLInputElement;
    await user.type(name, "Kỹ thuật");
    expect(slug.value).toBe("ky-thuat");
    await user.clear(slug);
    await user.type(slug, "Eng Team");
    expect(slug.value).toBe("eng-team");
    await user.type(name, " nền tảng");
    expect(slug.value).toBe("eng-team");
  });

  it("defaults to restricted and validates before calling the server", async () => {
    const { user, dialog } = await open();
    const restricted = within(dialog).getByRole("radio", {
      name: new RegExp(viSpace.visibility.restricted),
    });
    expect(restricted.getAttribute("aria-checked")).toBe("true");
    await user.click(within(dialog).getByRole("button", { name: viSpace.createDialog.submit }));
    expect(within(dialog).getByText(viSpace.form.nameRequired)).toBeTruthy();
    expect(within(dialog).getByText(viSpace.form.slugInvalid)).toBeTruthy();
    expect(actions.createSpace).not.toHaveBeenCalled();
  });

  it("shows the translated duplicate-slug error next to the slug", async () => {
    actions.createSpace.mockResolvedValue({ ok: false, error: "SPACE_SLUG_TAKEN" });
    const { user, dialog } = await open();
    await user.type(within(dialog).getByLabelText(viSpace.form.name), "Design");
    await user.click(within(dialog).getByRole("button", { name: viSpace.createDialog.submit }));
    const slug = within(dialog).getByLabelText(viSpace.form.slug);
    expect(await within(dialog).findByText(viErrors.SPACE_SLUG_TAKEN)).toBeTruthy();
    expect(slug.getAttribute("aria-invalid")).toBe("true");
    expect(actions.createSpace).toHaveBeenCalledWith({
      name: "Design",
      slug: "design",
      icon: null,
      description: null,
      visibility: "restricted",
    });
    expect(router.push).not.toHaveBeenCalled();
  });

  it("opens the new Space on success", async () => {
    actions.createSpace.mockResolvedValue({ ok: true, data: makeSpace({ slug: "ky-thuat" }) });
    const { user, dialog } = await open();
    await user.type(within(dialog).getByLabelText(viSpace.form.name), "Kỹ thuật");
    await user.click(within(dialog).getByRole("button", { name: viSpace.createDialog.submit }));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith("/s/ky-thuat"));
    expect(router.refresh).toHaveBeenCalled();
  });
});

describe("SpaceSettingsForm", () => {
  it("moves to the new URL when the slug changes", async () => {
    actions.updateSpace.mockResolvedValue({ ok: true, data: makeSpace({ slug: "design-team" }) });
    const user = userEvent.setup();
    renderWith(<SpaceSettingsForm space={makeSpace()} />, "en");
    const slug = screen.getByLabelText(enSpace.form.slug);
    await user.clear(slug);
    await user.type(slug, "design-team");
    await user.click(screen.getByRole("button", { name: enSpace.settingsPage.save }));
    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith("/s/design-team/settings"));
    expect(actions.updateSpace).toHaveBeenCalledWith(
      expect.objectContaining({ id: makeSpace().id, slug: "design-team", icon: "🎨" }),
    );
    expect(screen.getByRole("status").textContent).toBe(enSpace.settingsPage.saved);
  });

  it("shows a translated error for a non-admin", async () => {
    actions.updateSpace.mockResolvedValue({ ok: false, error: "FORBIDDEN" });
    const user = userEvent.setup();
    renderWith(<SpaceSettingsForm space={makeSpace()} />, "en");
    await user.click(screen.getByRole("button", { name: enSpace.settingsPage.save }));
    expect((await screen.findByRole("alert")).textContent).toBe(enErrors.FORBIDDEN);
  });
});

describe("ArchiveSpaceSection", () => {
  it("archives only after confirming, then returns to the list", async () => {
    actions.archiveSpace.mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup();
    renderWith(<ArchiveSpaceSection space={makeSpace()} />);
    await user.click(screen.getByRole("button", { name: viSpace.archiveSection.action }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/“Design”/)).toBeTruthy();
    expect(actions.archiveSpace).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: viSpace.archiveSection.confirm }));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith("/"));
    expect(actions.archiveSpace).toHaveBeenCalledWith({ id: makeSpace().id });
  });

  it("does nothing when cancelled", async () => {
    const user = userEvent.setup();
    renderWith(<ArchiveSpaceSection space={makeSpace()} />);
    await user.click(screen.getByRole("button", { name: viSpace.archiveSection.action }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: viCommon.actions.cancel }));
    expect(actions.archiveSpace).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
