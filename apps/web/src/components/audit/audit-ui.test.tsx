// @vitest-environment happy-dom
import enAudit from "@kb/i18n/messages/en/audit.json";
import enSpace from "@kb/i18n/messages/en/space.json";
import viAudit from "@kb/i18n/messages/vi/audit.json";
import viSpace from "@kb/i18n/messages/vi/space.json";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formats } from "@kb/i18n";

import type { AuditLogEntry } from "@/server/audit";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));

const { AuditFilterBar } = await import("./audit-filter-bar");
const { AuditLogList } = await import("./audit-log-list");

const messages = {
  vi: { audit: viAudit, space: viSpace },
  en: { audit: enAudit, space: enSpace },
};

function renderWith(ui: ReactNode, locale: "vi" | "en" = "vi") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={messages[locale]}
      formats={formats}
      timeZone="Asia/Ho_Chi_Minh"
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

const SPACE = "0b9a0000-0000-4000-8000-000000000001";
const BINH = "7c1e0000-0000-4000-8000-000000000003";
const actor = {
  id: "5d2f0000-0000-4000-8000-000000000002",
  email: "an.nguyen@example.com",
  fullName: "An Nguyễn",
  avatarUrl: null,
};

function entry(overrides: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: 1,
    occurredAt: "2026-09-25T03:15:00.123+00:00",
    action: "space.create",
    entityType: "space",
    entityId: SPACE,
    spaceId: SPACE,
    metadata: {},
    actor,
    ...overrides,
  };
}

const entries: AuditLogEntry[] = [
  entry({
    id: 3,
    action: "member.role_change",
    entityType: "member",
    entityId: BINH,
    metadata: { user_id: BINH, from_role: "viewer", to_role: "editor" },
  }),
  entry({
    id: 2,
    action: "space.update",
    metadata: { changes: { visibility: { from: "restricted", to: "internal" } } },
    actor: null,
  }),
  entry({ id: 1, action: "comment.create", entityType: "comment", metadata: {} }),
];
const people = { [BINH]: { id: BINH, email: "binh@example.com", fullName: "Bình Trần" } };

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("AuditLogList", () => {
  it("renders actor, translated action, target, details and local time (vi)", () => {
    renderWith(<AuditLogList entries={entries} people={people} />);
    const list = screen.getByRole("list", { name: viAudit.page.listLabel });
    const items = within(list)
      .getAllByRole("listitem")
      .filter((li) => li.parentElement === list);
    expect(items).toHaveLength(3);

    const [roleChange, update, unknown] = items as [HTMLElement, HTMLElement, HTMLElement];
    expect(within(roleChange).getByText("An Nguyễn")).toBeTruthy();
    expect(within(roleChange).getByText(viAudit.actions.member_role_change)).toBeTruthy();
    expect(within(roleChange).getByText("Bình Trần")).toBeTruthy();
    expect(
      within(roleChange).getByText(`${viSpace.roles.viewer} → ${viSpace.roles.editor}`),
    ).toBeTruthy();
    // 03:15 UTC → 10:15 in Asia/Ho_Chi_Minh.
    const time = within(roleChange).getByText(/10:15/);
    expect(time.tagName).toBe("TIME");
    expect(time.getAttribute("dateTime")).toBe("2026-09-25T03:15:00.123+00:00");

    expect(within(update).getByText(viAudit.actor.system)).toBeTruthy();
    expect(within(update).getByText(viAudit.entityTypes.space)).toBeTruthy();
    expect(
      within(update).getByText(
        `${viAudit.fields.visibility}: ${viSpace.visibility.restricted} → ${viSpace.visibility.internal}`,
      ),
    ).toBeTruthy();

    expect(within(unknown).getByText("Thao tác khác (comment.create)")).toBeTruthy();
    expect(within(unknown).getByText("comment")).toBeTruthy();
  });

  it("uses English labels and the unknown-user fallback (en)", () => {
    renderWith(
      <AuditLogList
        entries={[
          entry({
            action: "member.remove",
            entityType: "member",
            metadata: { user_id: BINH, role: "viewer", self: true },
          }),
        ]}
        people={{}}
      />,
      "en",
    );
    expect(screen.getByText(enAudit.actions.member_remove)).toBeTruthy();
    expect(screen.getByText(enAudit.actor.unknown)).toBeTruthy();
    expect(screen.getByText(`Role: ${enSpace.roles.viewer}`)).toBeTruthy();
    expect(screen.getByText(enAudit.details.left)).toBeTruthy();
  });
});

describe("AuditFilterBar", () => {
  const base = "/s/design/settings/audit";
  const none = { action: null, type: null, actor: null, from: null, to: null };
  const members = [{ id: BINH, name: "Bình Trần" }];

  beforeEach(() => router.push.mockClear());

  it("lists translated Space actions and navigates to the filtered first page", async () => {
    renderWith(<AuditFilterBar base={base} filters={none} people={members} />);
    const select = screen.getByLabelText(viAudit.page.filterLabel);
    expect((select as HTMLSelectElement).value).toBe("");
    expect(
      within(select).getByRole("option", { name: viAudit.actions.member_role_change }),
    ).toBeTruthy();
    expect(within(select).queryByRole("option", { name: viAudit.actions.access_add })).toBeNull();

    await userEvent.selectOptions(select, "member.role_change");
    expect(router.push).toHaveBeenCalledWith(`${base}?action=member.role_change`);
  });

  it("filters by type, dropping an action of another type (en)", async () => {
    renderWith(
      <AuditFilterBar base={base} filters={{ ...none, action: "member.add" }} people={members} />,
      "en",
    );
    await userEvent.selectOptions(screen.getByLabelText(enAudit.page.typeLabel), "page");
    expect(router.push).toHaveBeenCalledWith(`${base}?type=page`);
  });

  it("filters by person and day range", async () => {
    renderWith(<AuditFilterBar base={base} filters={none} people={members} />);
    await userEvent.selectOptions(screen.getByLabelText(viAudit.page.actorLabel), BINH);
    expect(router.push).toHaveBeenLastCalledWith(`${base}?actor=${BINH}`);
  });

  it("shows the clear button only when a filter is set", async () => {
    const { unmount } = renderWith(<AuditFilterBar base={base} filters={none} people={[]} />, "en");
    expect(screen.queryByRole("button", { name: enAudit.page.clearFilters })).toBeNull();
    unmount();
    renderWith(
      <AuditFilterBar base={base} filters={{ ...none, from: "2026-09-01" }} people={[]} />,
      "en",
    );
    await userEvent.click(screen.getByRole("button", { name: enAudit.page.clearFilters }));
    expect(router.push).toHaveBeenCalledWith(base);
  });
});
