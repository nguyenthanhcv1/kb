import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  ACCESS_TOKEN_TTL_SECONDS,
  addSeconds,
  AUTHORIZATION_CODE_TTL_SECONDS,
  generateToken,
  hashToken,
  type McpScope,
  oauthScopeString,
  parseOAuthScope,
  PERSONAL_TOKEN_TTL_DAYS,
  REFRESH_TOKEN_TTL_SECONDS,
  verifyPkce,
} from "./tokens";

/**
 * OAuth 2.1 authorization server of the MCP connector (MCP spec "Authorization", RFC 6749,
 * RFC 7636 PKCE, RFC 7591 dynamic client registration, RFC 7009 revocation). Server-only.
 *
 * claude.ai and ChatGPT register themselves (`registerClient`), send the user to
 * `/oauth/authorize` (consent screen, `validateAuthorizeRequest` + `approveAuthorization`), then
 * trade the code for tokens (`exchangeAuthorizationCode`, `refreshTokens`). Personal tokens for
 * clients configured by hand (Claude Code, Claude Desktop) are connections without a client.
 *
 * Every function takes the **service_role** client (`createAdminClient()`): tokens are checked
 * before any user session exists. Callers authorise the user themselves (the consent page needs a
 * signed-in user; Settings actions pass `getUser()`'s id).
 */

export type AdminDb = Pick<SupabaseClient, "from">;

/** Error of the token / registration endpoints (`{ error, error_description }`, RFC 6749 §5.2). */
export class OAuthError extends Error {
  constructor(
    readonly error:
      | "invalid_request"
      | "invalid_client"
      | "invalid_grant"
      | "unauthorized_client"
      | "unsupported_grant_type"
      | "invalid_scope"
      | "invalid_redirect_uri"
      | "invalid_client_metadata"
      | "access_denied"
      | "server_error",
    readonly description?: string,
    readonly status = 400,
  ) {
    super(description ? `${error}: ${description}` : error);
    this.name = "OAuthError";
  }

  toJSON() {
    return {
      error: this.error,
      ...(this.description ? { error_description: this.description } : {}),
    };
  }
}

const UUID = z.guid();

// ---------------------------------------------------------------------------
// Dynamic client registration
// ---------------------------------------------------------------------------

/** Unapproved registrations older than this are deleted on the next registration. */
const STALE_CLIENT_MS = 24 * 60 * 60 * 1000;

/** https, or http on a loopback host (native apps, RFC 8252 §7.3). No fragments. */
export function isAllowedRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export const registerClientInputSchema = z.object({
  client_name: z.string().trim().max(200).optional(),
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
});

export interface RegisteredClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  client_id_issued_at: number;
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
}

export async function registerClient(db: AdminDb, body: unknown): Promise<RegisteredClient> {
  const parsed = registerClientInputSchema.safeParse(body);
  if (!parsed.success) throw new OAuthError("invalid_client_metadata", "redirect_uris is required");
  const input = parsed.data;
  if (!input.redirect_uris.every(isAllowedRedirectUri)) {
    throw new OAuthError("invalid_redirect_uri", "redirect URIs must be https or loopback http");
  }
  if (input.grant_types?.some((type) => !["authorization_code", "refresh_token"].includes(type))) {
    throw new OAuthError("invalid_client_metadata", "unsupported grant type");
  }
  if (input.token_endpoint_auth_method && input.token_endpoint_auth_method !== "none") {
    // Public clients only: PKCE protects the code, no client secret to leak.
    throw new OAuthError("invalid_client_metadata", "only token_endpoint_auth_method=none");
  }

  await db
    .from("mcp_clients")
    .delete()
    .is("last_authorized_at", null)
    .lt("created_at", new Date(Date.now() - STALE_CLIENT_MS).toISOString());

  const clientName = input.client_name || "MCP client";
  const { data, error } = await db
    .from("mcp_clients")
    .insert({ client_name: clientName, redirect_uris: input.redirect_uris })
    .select("id, created_at")
    .single();
  if (error || !data) throw new OAuthError("server_error", undefined, 500);
  const row = data as { id: string; created_at: string };
  return {
    client_id: row.id,
    client_name: clientName,
    redirect_uris: input.redirect_uris,
    client_id_issued_at: Math.floor(new Date(row.created_at).getTime() / 1000),
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export interface McpClient {
  id: string;
  name: string;
  redirectUris: string[];
}

export async function getClient(db: AdminDb, clientId: string): Promise<McpClient | null> {
  if (!UUID.safeParse(clientId).success) return null;
  const { data, error } = await db
    .from("mcp_clients")
    .select("id, client_name, redirect_uris")
    .eq("id", clientId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { id: string; client_name: string; redirect_uris: string[] };
  return { id: row.id, name: row.client_name, redirectUris: row.redirect_uris };
}

// ---------------------------------------------------------------------------
// Authorization endpoint (consent page)
// ---------------------------------------------------------------------------

export interface AuthorizeRequest {
  client: McpClient;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  /** Scope the client asked for; the user may lower it to `read` on the consent screen. */
  scope: McpScope;
}

/**
 * Result of checking the query of `/oauth/authorize`. `error` with a `redirectUri` is sent back
 * to the client (RFC 6749 §4.1.2.1); without one (unknown client, unregistered redirect URI) it
 * must be shown to the user instead — never redirect to an unverified URI.
 */
export type AuthorizeValidation =
  | { ok: true; request: AuthorizeRequest }
  | { ok: false; error: string; redirectUri?: string; state?: string | null };

export async function validateAuthorizeRequest(
  db: AdminDb,
  params: Record<string, string | undefined>,
): Promise<AuthorizeValidation> {
  const client = params.client_id ? await getClient(db, params.client_id) : null;
  if (!client) return { ok: false, error: "invalid_client" };
  const redirectUri =
    params.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return { ok: false, error: "invalid_redirect_uri" };
  }
  const state = params.state ?? null;
  if (params.response_type !== "code") {
    return { ok: false, error: "unsupported_response_type", redirectUri, state };
  }
  const challenge = params.code_challenge ?? "";
  if (params.code_challenge_method !== "S256" || !/^[A-Za-z0-9\-_]{43}$/.test(challenge)) {
    return { ok: false, error: "invalid_request", redirectUri, state };
  }
  return {
    ok: true,
    request: {
      client,
      redirectUri,
      state,
      codeChallenge: challenge,
      scope: parseOAuthScope(params.scope),
    },
  };
}

/** `redirectUri?error=…&state=…` for an error the client should receive. */
export function authorizeErrorRedirect(
  redirectUri: string,
  error: string,
  state: string | null | undefined,
  issuer: string,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (state) url.searchParams.set("state", state);
  url.searchParams.set("iss", issuer);
  return url.toString();
}

export interface ApproveInput {
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  scope: McpScope;
  /** `iss` parameter of the response (RFC 9207) = the app origin. */
  issuer: string;
}

/**
 * The user allowed the client: creates (or re-scopes) their connection to it and returns the
 * redirect URL carrying a single-use code. Re-validates the client and redirect URI.
 */
export async function approveAuthorization(db: AdminDb, input: ApproveInput): Promise<string> {
  const client = await getClient(db, input.clientId);
  if (!client || !client.redirectUris.includes(input.redirectUri)) {
    throw new OAuthError("invalid_client");
  }

  const { data: existing, error: findError } = await db
    .from("mcp_connections")
    .select("id, scope")
    .eq("user_id", input.userId)
    .eq("client_id", client.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findError) throw new OAuthError("server_error", undefined, 500);

  let connectionId: string;
  if (existing) {
    const row = existing as { id: string; scope: McpScope };
    connectionId = row.id;
    if (row.scope !== input.scope) {
      const { error } = await db
        .from("mcp_connections")
        .update({ scope: input.scope })
        .eq("id", row.id);
      if (error) throw new OAuthError("server_error", undefined, 500);
    }
  } else {
    const { data, error } = await db
      .from("mcp_connections")
      .insert({
        user_id: input.userId,
        client_id: client.id,
        name: client.name,
        scope: input.scope,
      })
      .select("id")
      .single();
    if (error || !data) {
      if (error?.message === "MCP_CONNECTION_LIMIT")
        throw new OAuthError("access_denied", "MCP_CONNECTION_LIMIT", 403);
      throw new OAuthError("server_error", undefined, 500);
    }
    connectionId = (data as { id: string }).id;
  }

  await db
    .from("mcp_clients")
    .update({ last_authorized_at: new Date().toISOString() })
    .eq("id", client.id);

  const code = generateToken("code");
  const { error } = await db.from("mcp_tokens").insert({
    token_hash: hashToken(code),
    connection_id: connectionId,
    kind: "code",
    expires_at: addSeconds(new Date(), AUTHORIZATION_CODE_TTL_SECONDS).toISOString(),
    code_challenge: input.codeChallenge,
    redirect_uri: input.redirectUri,
  });
  if (error) throw new OAuthError("server_error", undefined, 500);

  const url = new URL(input.redirectUri);
  url.searchParams.set("code", code);
  if (input.state) url.searchParams.set("state", input.state);
  url.searchParams.set("iss", input.issuer);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

const tokenRowSchema = z.object({
  token_hash: z.string(),
  kind: z.enum(["code", "access", "refresh"]),
  expires_at: z.string(),
  used_at: z.string().nullable(),
  code_challenge: z.string().nullable(),
  redirect_uri: z.string().nullable(),
  connection: z.object({
    id: z.string(),
    user_id: z.string(),
    client_id: z.string().nullable(),
    name: z.string(),
    scope: z.enum(["read", "write"]),
    expires_at: z.string().nullable(),
    revoked_at: z.string().nullable(),
  }),
});
type TokenRow = z.infer<typeof tokenRowSchema>;

const TOKEN_SELECT =
  "token_hash, kind, expires_at, used_at, code_challenge, redirect_uri, " +
  "connection:mcp_connections!inner(id, user_id, client_id, name, scope, expires_at, revoked_at)";

async function findToken(db: AdminDb, raw: string): Promise<TokenRow | null> {
  if (!raw || raw.length > 200) return null;
  const { data, error } = await db
    .from("mcp_tokens")
    .select(TOKEN_SELECT)
    .eq("token_hash", hashToken(raw))
    .maybeSingle();
  if (error) throw new OAuthError("server_error", undefined, 500);
  if (!data) return null;
  const row = tokenRowSchema.safeParse(data);
  return row.success ? row.data : null;
}

/** Marks a single-use token used; `false` when someone else used it first. */
async function consume(db: AdminDb, tokenHash: string): Promise<boolean> {
  const { data, error } = await db
    .from("mcp_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .select("token_hash");
  if (error) throw new OAuthError("server_error", undefined, 500);
  return (data ?? []).length === 1;
}

async function revokeConnection(db: AdminDb, connectionId: string): Promise<void> {
  await db
    .from("mcp_connections")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", connectionId)
    .is("revoked_at", null);
}

function isLive(row: TokenRow, now = Date.now()): boolean {
  const connection = row.connection;
  return (
    new Date(row.expires_at).getTime() > now &&
    connection.revoked_at === null &&
    (connection.expires_at === null || new Date(connection.expires_at).getTime() > now)
  );
}

async function issueTokens(
  db: AdminDb,
  connectionId: string,
  scope: McpScope,
): Promise<TokenResponse> {
  const now = new Date();
  const access = generateToken("access");
  const refresh = generateToken("refresh");
  // Housekeeping: expired tokens of this connection are useless.
  await db
    .from("mcp_tokens")
    .delete()
    .eq("connection_id", connectionId)
    .lt("expires_at", now.toISOString());
  const { error } = await db.from("mcp_tokens").insert([
    {
      token_hash: hashToken(access),
      connection_id: connectionId,
      kind: "access",
      expires_at: addSeconds(now, ACCESS_TOKEN_TTL_SECONDS).toISOString(),
    },
    {
      token_hash: hashToken(refresh),
      connection_id: connectionId,
      kind: "refresh",
      expires_at: addSeconds(now, REFRESH_TOKEN_TTL_SECONDS).toISOString(),
    },
  ]);
  if (error) throw new OAuthError("server_error", undefined, 500);
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refresh,
    scope: oauthScopeString(scope),
  };
}

export async function exchangeAuthorizationCode(
  db: AdminDb,
  input: { code?: string; clientId?: string; redirectUri?: string; codeVerifier?: string },
): Promise<TokenResponse> {
  if (!input.code || !input.codeVerifier)
    throw new OAuthError("invalid_request", "code and code_verifier are required");
  const row = await findToken(db, input.code);
  if (!row || row.kind !== "code") throw new OAuthError("invalid_grant");
  if (input.clientId && row.connection.client_id !== input.clientId)
    throw new OAuthError("invalid_grant");
  if (input.redirectUri && row.redirect_uri !== input.redirectUri)
    throw new OAuthError("invalid_grant");
  if (row.used_at) {
    // A code replayed: someone may have stolen it — drop everything issued from it (RFC 6749 §4.1.2).
    await revokeConnection(db, row.connection.id);
    throw new OAuthError("invalid_grant");
  }
  if (!isLive(row)) throw new OAuthError("invalid_grant");
  if (!row.code_challenge || !verifyPkce(input.codeVerifier, row.code_challenge))
    throw new OAuthError("invalid_grant");
  if (!(await consume(db, row.token_hash))) throw new OAuthError("invalid_grant");
  return issueTokens(db, row.connection.id, row.connection.scope);
}

/** Rotates the refresh token (the old one stops working). */
export async function refreshTokens(
  db: AdminDb,
  input: { refreshToken?: string; clientId?: string },
): Promise<TokenResponse> {
  if (!input.refreshToken) throw new OAuthError("invalid_request", "refresh_token is required");
  const row = await findToken(db, input.refreshToken);
  if (!row || row.kind !== "refresh" || row.used_at || !isLive(row))
    throw new OAuthError("invalid_grant");
  if (input.clientId && row.connection.client_id !== input.clientId)
    throw new OAuthError("invalid_grant");
  if (!(await consume(db, row.token_hash))) throw new OAuthError("invalid_grant");
  return issueTokens(db, row.connection.id, row.connection.scope);
}

/** RFC 7009: revoking any token of a connection ends the connection. Unknown tokens are fine. */
export async function revokeToken(db: AdminDb, token: string | undefined): Promise<void> {
  if (!token) return;
  const row = await findToken(db, token);
  if (row) await revokeConnection(db, row.connection.id);
}

// ---------------------------------------------------------------------------
// Resource server: checking a bearer token
// ---------------------------------------------------------------------------

export interface McpPrincipal {
  userId: string;
  connectionId: string;
  scope: McpScope;
  /** Client name or personal token name (logs, `x-kb-client`). */
  name: string;
}

/** `last_used_at` is written at most this often per connection. */
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;
const lastUsedWrites = new Map<string, number>();

/** The connection behind an access token or personal token, or `null` (→ 401). */
export async function authenticateAccessToken(
  db: AdminDb,
  token: string,
): Promise<McpPrincipal | null> {
  const row = await findToken(db, token);
  if (!row || row.kind !== "access" || !isLive(row)) return null;

  const now = Date.now();
  if ((lastUsedWrites.get(row.connection.id) ?? 0) < now - LAST_USED_THROTTLE_MS) {
    lastUsedWrites.set(row.connection.id, now);
    await db
      .from("mcp_connections")
      .update({ last_used_at: new Date(now).toISOString() })
      .eq("id", row.connection.id);
  }
  return {
    userId: row.connection.user_id,
    connectionId: row.connection.id,
    scope: row.connection.scope,
    name: row.connection.name,
  };
}

// ---------------------------------------------------------------------------
// Personal access tokens
// ---------------------------------------------------------------------------

export const createPersonalTokenInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scope: z.enum(["read", "write"]),
  expiresInDays: z.union(
    PERSONAL_TOKEN_TTL_DAYS.map((days) => z.literal(days)) as [
      z.ZodLiteral<30>,
      z.ZodLiteral<90>,
      z.ZodLiteral<365>,
    ],
  ),
});
export type CreatePersonalTokenInput = z.input<typeof createPersonalTokenInputSchema>;

/** Creates a personal token for `userId` (already authenticated by the caller). Shown once. */
export async function createPersonalToken(
  db: AdminDb,
  userId: string,
  input: CreatePersonalTokenInput,
): Promise<{ connectionId: string; token: string; expiresAt: string }> {
  const { name, scope, expiresInDays } = createPersonalTokenInputSchema.parse(input);
  const expiresAt = addSeconds(new Date(), expiresInDays * 24 * 60 * 60).toISOString();
  const { data, error } = await db
    .from("mcp_connections")
    .insert({ user_id: userId, client_id: null, name, scope, expires_at: expiresAt })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.message === "MCP_CONNECTION_LIMIT")
      throw new OAuthError("access_denied", "MCP_CONNECTION_LIMIT", 403);
    throw new OAuthError("server_error", undefined, 500);
  }
  const connectionId = (data as { id: string }).id;
  const token = generateToken("personal");
  const { error: tokenError } = await db.from("mcp_tokens").insert({
    token_hash: hashToken(token),
    connection_id: connectionId,
    kind: "access",
    expires_at: expiresAt,
  });
  if (tokenError) {
    await revokeConnection(db, connectionId);
    throw new OAuthError("server_error", undefined, 500);
  }
  return { connectionId, token, expiresAt };
}
