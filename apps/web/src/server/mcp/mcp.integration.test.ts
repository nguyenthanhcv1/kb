/**
 * MCP connector end to end against PostgREST/RLS: OAuth (registration, consent, PKCE code,
 * refresh rotation, replay detection, revocation), personal tokens, and the tools over
 * Streamable HTTP with a user-scoped client. kb-collab is replaced by a fake that stores the
 * content the way collab would (page_documents.content_json).
 *
 * Needs `supabase start` (at least db, rest, kong):
 *   MCP_TEST_SUPABASE_URL=http://127.0.0.1:54321
 *   MCP_TEST_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long
 *   MCP_TEST_ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
 * Skipped when unset.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ReplaceDocumentInput } from "@/server/collab";

import { listMyConnections, revokeMyConnection } from "./connections";
import {
  approveAuthorization,
  authenticateAccessToken,
  createPersonalToken,
  exchangeAuthorizationCode,
  type McpPrincipal,
  OAuthError,
  refreshTokens,
  registerClient,
  revokeToken,
  validateAuthorizeRequest,
} from "./oauth";
import { handleMcpRequest } from "./server";
import { runTool, type ToolContext } from "./tools";
import { createUserClient } from "./user-client";

const URL_ = process.env.MCP_TEST_SUPABASE_URL;
const SECRET = process.env.MCP_TEST_JWT_SECRET;
const ADMIN_URL = process.env.MCP_TEST_ADMIN_DATABASE_URL;

const ids = { editor: randomUUID(), viewer: randomUUID(), space: randomUUID() };
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const ORIGIN = "https://kb.example.com";

let db: pg.Client;
let admin: SupabaseClient;
let anonKey: string;

async function jwt(claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(SECRET));
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Fake kb-collab: stores the document like the collab store hook does. */
const replaced: ReplaceDocumentInput[] = [];
async function fakeReplace(input: ReplaceDocumentInput) {
  replaced.push(input);
  await db.query("update public.page_documents set content_json = $2 where page_id = $1", [
    input.pageId,
    JSON.stringify(input.content),
  ]);
  return { pageId: input.pageId, schemaVersion: 1, connections: 0 };
}

async function contextFor(principal: McpPrincipal): Promise<ToolContext> {
  const client = await createUserClient(principal.userId, {
    url: URL_,
    anonKey,
    jwtSecret: SECRET,
  });
  return { db: client, principal, origin: ORIGIN, replaceDocument: fakeReplace };
}

async function connectClaude(userId: string, scope: "read" | "write" = "write") {
  const client = await registerClient(admin, { client_name: "Claude", redirect_uris: [REDIRECT] });
  const { verifier, challenge } = pkce();
  const redirect = await approveAuthorization(admin, {
    userId,
    clientId: client.client_id,
    redirectUri: REDIRECT,
    codeChallenge: challenge,
    state: "xyz",
    scope,
    issuer: ORIGIN,
  });
  const code = new URL(redirect).searchParams.get("code")!;
  return { client, verifier, code, redirect };
}

async function call<T = Record<string, unknown>>(ctx: ToolContext, name: string, input: unknown) {
  const outcome = await runTool(ctx, name, input);
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.error));
  return outcome.result as T;
}

describe.skipIf(!URL_ || !SECRET || !ADMIN_URL)("MCP connector through PostgREST", () => {
  beforeAll(async () => {
    db = new pg.Client({ connectionString: ADMIN_URL });
    await db.connect();
    anonKey = await jwt({ role: "anon" });
    admin = createClient(URL_!, await jwt({ role: "service_role" }), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await db.query(
      "insert into auth.users (id, email) select id, 'mcp-' || id || '@example.com' from unnest($1::uuid[]) as id",
      [[ids.editor, ids.viewer]],
    );
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.role', 'service_role', true)");
    await db.query("update public.profiles set is_guest = false where id = any($1::uuid[])", [
      [ids.editor, ids.viewer],
    ]);
    await db.query("commit");
    await db.query(
      "insert into public.spaces (id, slug, name, visibility, created_by) values ($1, $2, 'MCP test', 'restricted', $3)",
      [ids.space, `mcp-${ids.space.slice(0, 8)}`, ids.editor],
    );
    await db.query(
      "insert into public.space_members (space_id, user_id, role, added_by) values ($1, $2, 'viewer', $3)",
      [ids.space, ids.viewer, ids.editor],
    );
  });

  // Rows use random ids and stay in the throwaway local DB (audit triggers forbid most deletes).
  afterAll(async () => {
    await db?.end();
  });

  it("runs the OAuth flow with PKCE, rotation and replay detection", async () => {
    const { client, verifier, code, redirect } = await connectClaude(ids.editor);
    expect(new URL(redirect).searchParams.get("state")).toBe("xyz");
    expect(new URL(redirect).searchParams.get("iss")).toBe(ORIGIN);

    await expect(
      exchangeAuthorizationCode(admin, {
        code,
        clientId: client.client_id,
        redirectUri: REDIRECT,
        codeVerifier: pkce().verifier,
      }),
    ).rejects.toBeInstanceOf(OAuthError);

    const tokens = await exchangeAuthorizationCode(admin, {
      code,
      clientId: client.client_id,
      redirectUri: REDIRECT,
      codeVerifier: verifier,
    });
    expect(tokens.access_token).toMatch(/^kba_/);
    expect(tokens.scope).toBe("kb:read kb:write");
    const principal = await authenticateAccessToken(admin, tokens.access_token);
    expect(principal).toMatchObject({ userId: ids.editor, scope: "write", name: "Claude" });

    const rotated = await refreshTokens(admin, {
      refreshToken: tokens.refresh_token,
      clientId: client.client_id,
    });
    await expect(
      refreshTokens(admin, { refreshToken: tokens.refresh_token }),
    ).rejects.toMatchObject({ error: "invalid_grant" });

    // Replaying the code revokes the whole connection.
    await expect(
      exchangeAuthorizationCode(admin, { code, codeVerifier: verifier }),
    ).rejects.toMatchObject({ error: "invalid_grant" });
    expect(await authenticateAccessToken(admin, rotated.access_token)).toBeNull();
  });

  it("checks authorize requests before showing the consent screen", async () => {
    const client = await registerClient(admin, { redirect_uris: [REDIRECT] });
    const { challenge } = pkce();
    const base = {
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "kb:read",
    };
    const ok = await validateAuthorizeRequest(admin, base);
    expect(ok).toMatchObject({ ok: true, request: { scope: "read", redirectUri: REDIRECT } });
    expect(
      await validateAuthorizeRequest(admin, { ...base, redirect_uri: "https://evil.test/cb" }),
    ).toEqual({ ok: false, error: "invalid_redirect_uri" });
    expect(
      await validateAuthorizeRequest(admin, { ...base, code_challenge_method: "plain" }),
    ).toMatchObject({ ok: false, error: "invalid_request", redirectUri: REDIRECT });
    await expect(
      registerClient(admin, { redirect_uris: ["http://evil.test/cb"] }),
    ).rejects.toMatchObject({ error: "invalid_redirect_uri" });
  });

  it("creates, reads, edits, moves and trashes pages as the user", async () => {
    const { client, verifier, code } = await connectClaude(ids.editor);
    const tokens = await exchangeAuthorizationCode(admin, {
      code,
      clientId: client.client_id,
      codeVerifier: verifier,
    });
    const ctx = await contextFor((await authenticateAccessToken(admin, tokens.access_token))!);

    const { spaces } = await call<{ spaces: { id: string; role: string }[] }>(
      ctx,
      "list_spaces",
      {},
    );
    expect(spaces.find((space) => space.id === ids.space)?.role).toBe("admin");

    const parent = await call<{ id: string; url: string }>(ctx, "create_page", {
      spaceId: ids.space,
      title: "Quy trình",
      icon: "📘",
    });
    expect(parent.url).toMatch(/^https:\/\/kb\.example\.com\/s\/mcp-/);
    const page = await call<{ id: string }>(ctx, "create_page", {
      spaceId: ids.space,
      parentId: parent.id,
      title: "Nghỉ phép",
      markdown: "Đoạn đầu\n\n- một\n- hai\n\n> [!WARNING]\n> Lưu ý",
    });
    expect(replaced.at(-1)).toMatchObject({
      pageId: page.id,
      actorId: ids.editor,
      reason: "assistant",
    });

    const read = await call<{ markdown: string; path: { title: string }[]; canEdit: boolean }>(
      ctx,
      "get_page",
      { page: page.id },
    );
    expect(read.markdown).toBe("Đoạn đầu\n\n- một\n- hai\n\n> [!WARNING]\n> Lưu ý\n");
    expect(read.path.map((item) => item.title)).toEqual(["Quy trình"]);
    expect(read.canEdit).toBe(true);

    const { blocks } = await call<{ blocks: { id: string; markdown: string }[] }>(ctx, "get_page", {
      page: page.id,
      format: "blocks",
    });
    await call(ctx, "update_page", {
      page: page.id,
      title: "Nghỉ phép năm",
      edits: [{ op: "replace", blockId: blocks[0]!.id, markdown: "## Đoạn mới" }],
    });
    const { blocks: after } = await call<{ blocks: { id: string; markdown: string }[] }>(
      ctx,
      "get_page",
      { page: page.id, format: "blocks" },
    );
    expect(after.map((block) => block.markdown)[0]).toBe("## Đoạn mới");
    // Untouched blocks keep their ids.
    expect(after.slice(1).map((block) => block.id)).toEqual(
      blocks.slice(1).map((block) => block.id),
    );

    const tree = await call<{ pages: { title: string; children?: { title: string }[] }[] }>(
      ctx,
      "list_pages",
      { spaceId: ids.space },
    );
    expect(tree.pages[0]).toMatchObject({
      title: "Quy trình",
      children: [{ title: "Nghỉ phép năm" }],
    });

    await call(ctx, "move_page", { page: page.id, parentId: null });
    await call(ctx, "delete_page", { page: page.id });
    const trashed = await call<{ inTrash: boolean }>(ctx, "get_page", { page: page.id });
    expect(trashed.inTrash).toBe(true);
    await call(ctx, "restore_page", { page: page.id });
  });

  it("enforces RLS and the connection scope", async () => {
    const editorToken = await createPersonalToken(admin, ids.editor, {
      name: "Laptop",
      scope: "write",
      expiresInDays: 30,
    });
    const editorCtx = await contextFor((await authenticateAccessToken(admin, editorToken.token))!);
    const page = await call<{ id: string }>(editorCtx, "create_page", {
      spaceId: ids.space,
      title: "Chỉ đọc",
    });

    const viewerToken = await createPersonalToken(admin, ids.viewer, {
      name: "Viewer laptop",
      scope: "write",
      expiresInDays: 30,
    });
    const viewerCtx = await contextFor((await authenticateAccessToken(admin, viewerToken.token))!);
    expect(await call(viewerCtx, "get_page", { page: page.id })).toMatchObject({ canEdit: false });
    expect(await runTool(viewerCtx, "update_page", { page: page.id, markdown: "x" })).toEqual({
      ok: false,
      error: { error: "FORBIDDEN" },
    });

    const { client, verifier, code } = await connectClaude(ids.viewer, "read");
    const readTokens = await exchangeAuthorizationCode(admin, {
      code,
      clientId: client.client_id,
      codeVerifier: verifier,
    });
    const readCtx = await contextFor(
      (await authenticateAccessToken(admin, readTokens.access_token))!,
    );
    expect(await runTool(readCtx, "delete_page", { page: page.id })).toEqual({
      ok: false,
      error: { error: "MCP_READ_ONLY" },
    });

    // Settings: the viewer sees and revokes their own connections.
    const viewerSession = createClient(URL_!, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: {
          Authorization: `Bearer ${await jwt({ role: "authenticated", sub: ids.viewer, aud: "authenticated" })}`,
        },
      },
    });
    const connections = await listMyConnections(viewerSession);
    expect(connections.map((connection) => connection.kind).sort()).toEqual([
      "assistant",
      "personal",
    ]);
    await revokeMyConnection(viewerSession, connections.find((c) => c.kind === "personal")!.id);
    expect(await authenticateAccessToken(admin, viewerToken.token)).toBeNull();
    await revokeToken(admin, readTokens.refresh_token);
    expect(await authenticateAccessToken(admin, readTokens.access_token)).toBeNull();
    expect(await listMyConnections(viewerSession)).toHaveLength(0);
  });

  it("answers MCP JSON-RPC over Streamable HTTP", async () => {
    const { token } = await createPersonalToken(admin, ids.editor, {
      name: "HTTP",
      scope: "read",
      expiresInDays: 30,
    });
    const ctx = await contextFor((await authenticateAccessToken(admin, token))!);
    const post = (body: unknown) =>
      handleMcpRequest(
        new Request("http://localhost/api/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "mcp-protocol-version": "2025-06-18",
          },
          body: JSON.stringify(body),
        }),
        ctx,
      );

    const init = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    });
    expect(init.status).toBe(200);
    expect((await init.json()) as unknown).toMatchObject({
      result: { serverInfo: { name: "kb" }, capabilities: { tools: {} } },
    });

    const list = (await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as {
      result: { tools: { name: string }[] };
    };
    // Read-only connection: no writing tools at all.
    expect(list.result.tools.map((tool) => tool.name).sort()).toEqual([
      "get_page",
      "list_pages",
      "list_spaces",
      "search_pages",
    ]);

    const result = (await (
      await post({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "list_spaces", arguments: {} },
      })
    ).json()) as { result: { content: { text: string }[]; isError?: boolean } };
    expect(result.result.isError).toBeUndefined();
    expect(result.result.content[0]!.text).toContain("MCP test");
  });
});
