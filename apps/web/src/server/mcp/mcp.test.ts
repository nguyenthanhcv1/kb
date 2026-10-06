import { createHash } from "node:crypto";

import { decodeJwt } from "jose";
import { describe, expect, it, vi } from "vitest";

import { authorizationServerMetadata, mcpUrls, protectedResourceMetadata } from "./http";
import { isAllowedRedirectUri } from "./oauth";
import { generateToken, hashToken, oauthScopeString, parseOAuthScope, verifyPkce } from "./tokens";
import { runTool, type ToolContext } from "./tools";
import { createUserClient, signUserJwt, USER_JWT_TTL_SECONDS } from "./user-client";

const SECRET = "x".repeat(32);

describe("tokens", () => {
  it("generates prefixed random tokens and hashes them with sha256", () => {
    const token = generateToken("access");
    expect(token).toMatch(/^kba_[A-Za-z0-9_-]{43}$/);
    expect(generateToken("access")).not.toBe(token);
    expect(hashToken("abc")).toBe(createHash("sha256").update("abc").digest("hex"));
  });

  it("verifies PKCE S256 only", () => {
    const verifier = "a".repeat(43);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce("b".repeat(43), challenge)).toBe(false);
    expect(verifyPkce("short", challenge)).toBe(false);
    expect(verifyPkce(verifier, verifier)).toBe(false);
  });

  it("maps OAuth scopes", () => {
    expect(parseOAuthScope("kb:read")).toBe("read");
    expect(parseOAuthScope("kb:read kb:write")).toBe("write");
    expect(parseOAuthScope(undefined)).toBe("write");
    expect(parseOAuthScope("openid")).toBe("read");
    expect(oauthScopeString("read")).toBe("kb:read");
  });
});

describe("redirect URIs", () => {
  it.each([
    ["https://claude.ai/api/mcp/auth_callback", true],
    ["https://chatgpt.com/connector_platform_oauth_redirect", true],
    ["http://localhost:6274/oauth/callback", true],
    ["http://127.0.0.1:33418/", true],
    ["http://evil.test/cb", false],
    ["https://claude.ai/cb#frag", false],
    ["javascript:alert(1)", false],
    ["not a url", false],
  ])("%s → %s", (uri, allowed) => {
    expect(isAllowedRedirectUri(uri)).toBe(allowed);
  });
});

describe("metadata", () => {
  it("points the resource at kb-web as its own authorization server", () => {
    const origin = "https://kb.example.com";
    expect(mcpUrls(origin).resourceMetadata).toBe(
      "https://kb.example.com/.well-known/oauth-protected-resource/api/mcp",
    );
    expect(protectedResourceMetadata(origin)).toMatchObject({
      resource: "https://kb.example.com/api/mcp",
      authorization_servers: [origin],
    });
    expect(authorizationServerMetadata(origin)).toMatchObject({
      issuer: origin,
      authorization_endpoint: "https://kb.example.com/oauth/authorize",
      token_endpoint: "https://kb.example.com/api/oauth/token",
      registration_endpoint: "https://kb.example.com/api/oauth/register",
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });
});

describe("user client", () => {
  it("signs a short-lived authenticated JWT for the user", async () => {
    const now = new Date("2026-10-06T00:00:00Z");
    const claims = decodeJwt(await signUserJwt("u-1", SECRET, now));
    expect(claims).toMatchObject({ sub: "u-1", role: "authenticated", aud: "authenticated" });
    expect(claims.exp! - claims.iat!).toBe(USER_JWT_TTL_SECONDS);
  });

  it("answers auth.getUser locally and sends the JWT to PostgREST", async () => {
    const fetchSpy = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetchSpy);
    const client = await createUserClient("11111111-1111-4111-8111-111111111111", {
      url: "http://127.0.0.1:54321",
      anonKey: "anon",
      jwtSecret: SECRET,
    });
    expect((await client.auth.getUser()).data.user?.id).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    await client.from("pages").select("id");
    const headers = new Headers(
      (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].headers,
    );
    expect(decodeJwt(headers.get("authorization")!.replace("Bearer ", "")).sub).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    vi.unstubAllGlobals();
  });
});

describe("runTool", () => {
  const ctx = (scope: "read" | "write") =>
    ({
      db: {} as ToolContext["db"],
      principal: { userId: "u", connectionId: "c", scope, name: "Claude" },
      origin: "https://kb.example.com",
    }) satisfies ToolContext;

  it("refuses writing tools on read-only connections", async () => {
    expect(await runTool(ctx("read"), "delete_page", { page: "x" })).toEqual({
      ok: false,
      error: { error: "MCP_READ_ONLY" },
    });
  });

  it("validates input and unknown tools", async () => {
    expect(await runTool(ctx("write"), "nope", {})).toEqual({
      ok: false,
      error: { error: "TOOL_NOT_FOUND" },
    });
    const outcome = await runTool(ctx("write"), "search_pages", { query: "" });
    expect(outcome).toMatchObject({ ok: false, error: { error: "VALIDATION_FAILED" } });
  });
});
