import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Token primitives of the MCP connector. Raw tokens only ever travel to the client; the DB keeps
 * their sha256 (`mcp_tokens.token_hash`). Prefixes make a leaked token recognisable in logs and
 * secret scanners (`kbp_` personal, `kba_` OAuth access, `kbr_` refresh, `kbc_` code).
 */

import type { McpScope } from "./constants";

export { MCP_SCOPES, type McpScope, PERSONAL_TOKEN_TTL_DAYS } from "./constants";

/** OAuth scope strings (RFC 6749 §3.3) ↔ connection scope. `kb:write` implies reading. */
export const OAUTH_SCOPES = { read: "kb:read", write: "kb:write" } as const;

export const TOKEN_PREFIX = {
  personal: "kbp_",
  access: "kba_",
  refresh: "kbr_",
  code: "kbc_",
} as const;
export type TokenType = keyof typeof TOKEN_PREFIX;

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
export const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;

export function generateToken(type: TokenType): string {
  return `${TOKEN_PREFIX[type]}${randomBytes(32).toString("base64url")}`;
}

/** sha256 hex — the value stored in `mcp_tokens.token_hash`. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** PKCE S256 (RFC 7636 §4.6): `BASE64URL(SHA256(verifier)) === challenge`. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const expected = Buffer.from(createHash("sha256").update(verifier, "ascii").digest("base64url"));
  const actual = Buffer.from(challenge);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** `"kb:read kb:write"` → strongest scope requested; unknown scopes are ignored. */
export function parseOAuthScope(scope: string | null | undefined): McpScope {
  const requested = new Set((scope ?? "").split(/\s+/).filter(Boolean));
  if (requested.size === 0 || requested.has(OAUTH_SCOPES.write)) return "write";
  return "read";
}

export function oauthScopeString(scope: McpScope): string {
  return scope === "write" ? `${OAUTH_SCOPES.read} ${OAUTH_SCOPES.write}` : OAUTH_SCOPES.read;
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}
