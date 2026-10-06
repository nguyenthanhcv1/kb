import { createHash, randomBytes } from "node:crypto";

import type viMcp from "@kb/i18n/messages/vi/mcp.json";
import type { APIRequestContext } from "@playwright/test";

import { e2eLocale, supabaseEnv } from "../support/env";
import { message } from "../support/messages";
import { contextFor, createSpace, createTestUser, uniqueSuffix } from "../support/space";
import { expect, test } from "../support/test";

/**
 * MCP connector: a personal token created in Settings drives the MCP endpoint (create a page
 * with Markdown content, visible in the editor), revoking it cuts access; the OAuth consent
 * screen hands claude.ai / ChatGPT a code that the token endpoint exchanges (PKCE).
 */
const locale = e2eLocale();
const m = message<typeof viMcp>(locale, "mcp");

test.skip(!supabaseEnv(), "E2E_SUPABASE_* is not set (creates the user)");

let rpcId = 0;
async function mcp(request: APIRequestContext, token: string, method: string, params?: unknown) {
  return request.post("/api/mcp", {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
    },
    data: { jsonrpc: "2.0", id: ++rpcId, method, ...(params ? { params } : {}) },
  });
}

async function callTool(request: APIRequestContext, token: string, name: string, args: unknown) {
  const response = await mcp(request, token, "tools/call", { name, arguments: args });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    result: { content: { text: string }[]; isError?: boolean };
  };
  expect(body.result.isError, body.result.content[0]?.text).toBeFalsy();
  return JSON.parse(body.result.content[0]!.text) as Record<string, unknown>;
}

test("a personal token lets an assistant create pages until it is revoked", async ({
  browser,
}, testInfo) => {
  const user = await createTestUser("mcp-token");
  const context = await contextFor(browser, user);
  const page = await context.newPage();
  const spaceName = `MCP ${uniqueSuffix(testInfo)}`;
  await createSpace(page, spaceName);

  await page.goto("/settings");
  const section = page.getByRole("region", { name: m.section.title });
  await expect(section.getByRole("textbox", { name: m.serverUrl.label })).toHaveValue(
    /\/api\/mcp$/,
  );
  await section.getByRole("textbox", { name: m.token.name }).fill("E2E laptop");
  await section.getByRole("button", { name: m.token.create }).click();
  const token = await section
    .getByRole("textbox", { name: m.token.value, exact: true })
    .inputValue();
  expect(token).toMatch(/^kbp_/);
  await section.getByRole("button", { name: m.token.done }).click();
  await expect(section.getByText("E2E laptop")).toBeVisible();

  const { spaces } = (await callTool(page.request, token, "list_spaces", {})) as {
    spaces: { id: string; name: string }[];
  };
  const space = spaces.find((item) => item.name === spaceName)!;
  const created = await callTool(page.request, token, "create_page", {
    spaceId: space.id,
    title: "Viết bởi trợ lý",
    markdown: "## Mục tiêu\n\n- [ ] Việc cần làm",
  });

  await page.goto(String(created.url));
  await expect(page.getByRole("heading", { name: "Mục tiêu" })).toBeVisible();

  await page.goto("/settings");
  await section
    .getByRole("button", { name: m.connections.revokeLabel.replace("{name}", "E2E laptop") })
    .click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: m.connections.revokeConfirm }).click();
  // The modal hides the region from the accessibility tree: wait for it to close first.
  await expect(dialog).toBeHidden();
  await expect(section.getByText(m.connections.empty)).toBeVisible();
  const after = await mcp(page.request, token, "tools/list");
  expect(after.status(), await after.text()).toBe(401);
  await context.close();
});

test("the consent screen gives an OAuth client a code for tokens", async ({ browser }) => {
  const user = await createTestUser("mcp-oauth");
  const context = await contextFor(browser, user);
  const page = await context.newPage();
  const redirectUri = "http://localhost:3999/callback";

  const registration = await page.request.post("/api/oauth/register", {
    data: { client_name: "E2E Assistant", redirect_uris: [redirectUri] },
  });
  expect(registration.status()).toBe(201);
  const { client_id: clientId } = (await registration.json()) as { client_id: string };

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "e2e-state",
    scope: "kb:read",
  });
  await page.route("http://localhost:3999/**", (route) => route.fulfill({ body: "ok" }));
  await page.goto(`/oauth/authorize?${query}`);
  await expect(page.getByRole("heading", { name: m.consent.title })).toBeVisible();
  await expect(page.getByText("E2E Assistant", { exact: false })).toBeVisible();
  await expect(page.getByRole("radio", { name: new RegExp(m.scopes.read) })).toBeChecked();
  await page.getByRole("button", { name: m.consent.allow }).click();

  await page.waitForURL(/localhost:3999\/callback/);
  const callback = new URL(page.url());
  expect(callback.searchParams.get("state")).toBe("e2e-state");
  const tokenResponse = await page.request.post("/api/oauth/token", {
    form: {
      grant_type: "authorization_code",
      code: callback.searchParams.get("code")!,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    },
  });
  expect(tokenResponse.status()).toBe(200);
  const tokens = (await tokenResponse.json()) as { access_token: string; scope: string };
  expect(tokens.scope).toBe("kb:read");

  const list = (await (await mcp(page.request, tokens.access_token, "tools/list")).json()) as {
    result: { tools: { name: string }[] };
  };
  expect(list.result.tools.map((tool) => tool.name)).not.toContain("create_page");
  await context.close();
});
