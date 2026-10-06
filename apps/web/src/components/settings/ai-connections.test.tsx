// @vitest-environment happy-dom
import enCommon from "@kb/i18n/messages/en/common.json";
import enErrors from "@kb/i18n/messages/en/errors.json";
import enMcp from "@kb/i18n/messages/en/mcp.json";
import enSettings from "@kb/i18n/messages/en/settings.json";
import viCommon from "@kb/i18n/messages/vi/common.json";
import viErrors from "@kb/i18n/messages/vi/errors.json";
import viMcp from "@kb/i18n/messages/vi/mcp.json";
import viSettings from "@kb/i18n/messages/vi/settings.json";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { McpConnection } from "@/server/mcp/connections";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const actions = vi.hoisted(() => ({
  createPersonalTokenAction: vi.fn(),
  revokeConnectionAction: vi.fn(),
  approveAuthorizationAction: vi.fn(),
  denyAuthorizationAction: vi.fn(),
}));
vi.mock("@/server/mcp/actions", () => actions);

const { AiConnectionsSection } = await import("./ai-connections-section");
const { ConsentForm } = await import("@/app/(auth)/oauth/authorize/consent-form");

const messages = {
  vi: { common: viCommon, errors: viErrors, settings: viSettings, mcp: viMcp },
  en: { common: enCommon, errors: enErrors, settings: enSettings, mcp: enMcp },
};

function renderWith(ui: ReactNode, locale: "vi" | "en" = "vi") {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Asia/Ho_Chi_Minh">
      {ui}
    </NextIntlClientProvider>,
  );
}

const MCP_URL = "https://kb.example.com/api/mcp";
const connections: McpConnection[] = [
  {
    id: "30000000-0000-0000-0000-000000000001",
    kind: "assistant",
    name: "Claude",
    scope: "write",
    createdAt: "2026-10-01T03:00:00Z",
    lastUsedAt: "2026-10-05T03:00:00Z",
    expiresAt: null,
  },
  {
    id: "30000000-0000-0000-0000-000000000002",
    kind: "personal",
    name: "Laptop",
    scope: "read",
    createdAt: "2026-10-02T03:00:00Z",
    lastUsedAt: null,
    expiresAt: "2027-01-01T03:00:00Z",
  },
];

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("AiConnectionsSection", () => {
  it("shows the server address, the setup guide and the connections", () => {
    renderWith(
      <AiConnectionsSection mcpUrl={MCP_URL} configured connections={connections} />,
      "en",
    );
    expect(screen.getByRole("heading", { name: "AI assistants (MCP)" })).toBeTruthy();
    expect((screen.getByLabelText("MCP server address") as HTMLInputElement).value).toBe(MCP_URL);
    expect(
      screen.getByText(/claude mcp add --transport http kb https:\/\/kb\.example\.com/),
    ).toBeTruthy();
    const rows = screen.getAllByRole("listitem").filter((item) => item.querySelector("button"));
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("AI assistant")).toBeTruthy();
    expect(within(rows[0]!).getByText("Read and edit")).toBeTruthy();
    expect(within(rows[1]!).getByText(/Never used/)).toBeTruthy();
    expect(within(rows[1]!).getByText(/Expires/)).toBeTruthy();
  });

  it("creates a personal token and shows it once", async () => {
    actions.createPersonalTokenAction.mockResolvedValue({
      ok: true,
      data: { token: "kbp_secret", expiresAt: "2027-01-01T00:00:00Z" },
    });
    const user = userEvent.setup();
    renderWith(<AiConnectionsSection mcpUrl={MCP_URL} configured connections={[]} />);

    await user.click(screen.getByRole("button", { name: "Tạo token" }));
    expect(screen.getByText("Nhập tên token.")).toBeTruthy();
    expect(actions.createPersonalTokenAction).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Tên token"), "Laptop");
    await user.click(screen.getByLabelText(/Chỉ đọc/));
    await user.selectOptions(screen.getByLabelText("Thời hạn"), "30");
    await user.click(screen.getByRole("button", { name: "Tạo token" }));

    expect(actions.createPersonalTokenAction).toHaveBeenCalledWith({
      name: "Laptop",
      scope: "read",
      expiresInDays: 30,
    });
    expect((await screen.findByDisplayValue("kbp_secret")) as HTMLInputElement).toBeTruthy();
    expect(screen.getByText(/lần duy nhất/)).toBeTruthy();
    expect(router.refresh).toHaveBeenCalled();
  });

  it("revokes a connection after confirmation", async () => {
    actions.revokeConnectionAction.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    renderWith(<AiConnectionsSection mcpUrl={MCP_URL} configured connections={connections} />);

    await user.click(screen.getByRole("button", { name: "Thu hồi Claude" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Thu hồi" }));
    expect(actions.revokeConnectionAction).toHaveBeenCalledWith(connections[0]!.id);
    expect(router.refresh).toHaveBeenCalled();
  });

  it("explains when the server has no connector and hides token creation", () => {
    renderWith(<AiConnectionsSection mcpUrl={MCP_URL} configured={false} connections={[]} />);
    expect(screen.getByText(/chưa bật kết nối MCP/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tạo token" })).toBeNull();
  });
});

describe("ConsentForm", () => {
  const props = {
    clientId: "20000000-0000-0000-0000-000000000001",
    redirectUri: "https://claude.ai/api/mcp/auth_callback",
    redirectHost: "claude.ai",
    codeChallenge: "c".repeat(43),
    state: "xyz",
    defaultScope: "write" as const,
  };

  it("approves with the chosen scope and follows the returned URL", async () => {
    actions.approveAuthorizationAction.mockResolvedValue({
      ok: true,
      data: { redirectTo: "https://claude.ai/api/mcp/auth_callback?code=kbc_x" },
    });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const user = userEvent.setup();
    renderWith(<ConsentForm {...props} />, "en");

    expect(screen.getByText(/sent back to claude\.ai/)).toBeTruthy();
    await user.click(screen.getByLabelText(/Read only/));
    await user.click(screen.getByRole("button", { name: "Allow" }));
    expect(actions.approveAuthorizationAction).toHaveBeenCalledWith({
      clientId: props.clientId,
      redirectUri: props.redirectUri,
      codeChallenge: props.codeChallenge,
      state: "xyz",
      scope: "read",
    });
    expect(assign).toHaveBeenCalledWith("https://claude.ai/api/mcp/auth_callback?code=kbc_x");
    vi.unstubAllGlobals();
  });

  it("shows a translated error when approval fails", async () => {
    actions.approveAuthorizationAction.mockResolvedValue({
      ok: false,
      error: "MCP_CONNECTION_LIMIT",
    });
    const user = userEvent.setup();
    renderWith(<ConsentForm {...props} />, "en");
    await user.click(screen.getByRole("button", { name: "Allow" }));
    expect(await screen.findByText(/too many connections/)).toBeTruthy();
  });
});
