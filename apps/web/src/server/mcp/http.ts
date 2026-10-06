import { OAUTH_SCOPES } from "./tokens";

/**
 * URLs and metadata documents of the MCP connector (MCP spec "Authorization": RFC 9728 protected
 * resource metadata, RFC 8414 authorization server metadata). kb-web is both the resource server
 * (`/api/mcp`) and the authorization server; the issuer is the public app origin.
 */

export const MCP_PATH = "/api/mcp";
export const AUTHORIZE_PATH = "/oauth/authorize";
export const TOKEN_PATH = "/api/oauth/token";
export const REGISTER_PATH = "/api/oauth/register";
export const REVOKE_PATH = "/api/oauth/revoke";
export const PROTECTED_RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`;

export function mcpUrls(origin: string) {
  const url = (path: string) => new URL(path, origin).toString();
  return {
    issuer: origin,
    mcp: url(MCP_PATH),
    authorize: url(AUTHORIZE_PATH),
    token: url(TOKEN_PATH),
    register: url(REGISTER_PATH),
    revoke: url(REVOKE_PATH),
    resourceMetadata: url(PROTECTED_RESOURCE_METADATA_PATH),
  };
}

export function protectedResourceMetadata(origin: string) {
  const urls = mcpUrls(origin);
  return {
    resource: urls.mcp,
    authorization_servers: [urls.issuer],
    scopes_supported: Object.values(OAUTH_SCOPES),
    bearer_methods_supported: ["header"],
    resource_name: "KB",
  };
}

export function authorizationServerMetadata(origin: string) {
  const urls = mcpUrls(origin);
  return {
    issuer: urls.issuer,
    authorization_endpoint: urls.authorize,
    token_endpoint: urls.token,
    registration_endpoint: urls.register,
    revocation_endpoint: urls.revoke,
    scopes_supported: Object.values(OAUTH_SCOPES),
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
  };
}

/**
 * Bearer tokens, never cookies: any origin may call these endpoints (browser-based MCP clients,
 * the MCP inspector). Page responses keep their strict headers.
 */
export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers":
    "authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "www-authenticate, mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
};

export const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" };

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return Response.json(body, {
    status: init.status ?? 200,
    headers: { ...CORS_HEADERS, ...NO_STORE, ...init.headers },
  });
}

/** Form-encoded (RFC 6749) or JSON body of the OAuth endpoints as a flat string map. */
export async function readParams(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(body ?? {}).flatMap(([key, value]) =>
          typeof value === "string" ? [[key, value]] : [],
        ),
      );
    }
    const form = new URLSearchParams(await request.text());
    return Object.fromEntries(form.entries());
  } catch {
    return {};
  }
}
