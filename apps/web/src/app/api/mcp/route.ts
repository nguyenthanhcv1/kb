import { publicOrigin } from "@/lib/public-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { CORS_HEADERS, corsPreflight, jsonResponse, mcpUrls } from "@/server/mcp/http";
import { authenticateAccessToken } from "@/server/mcp/oauth";
import { handleMcpRequest } from "@/server/mcp/server";
import { createUserClient, isUserClientConfigured } from "@/server/mcp/user-client";

export const dynamic = "force-dynamic";

/**
 * MCP endpoint for AI assistants (Streamable HTTP, stateless; docs in `server/mcp`). Clients
 * authenticate with an OAuth access token or a personal token (`Authorization: Bearer …`); a
 * missing or bad token gets 401 with the protected-resource metadata URL so claude.ai / ChatGPT
 * start the OAuth flow by themselves.
 */
export async function POST(request: Request) {
  const origin = publicOrigin(request.url);
  if (!isUserClientConfigured()) {
    return jsonResponse({ error: "MCP_NOT_CONFIGURED" }, { status: 503 });
  }

  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (!token) return unauthorized(origin);

  const admin = createAdminClient();
  const principal = await authenticateAccessToken(admin, token).catch((error: unknown) => {
    console.error("[mcp] token check failed", error);
    return null;
  });
  if (!principal) return unauthorized(origin, "invalid_token");

  const db = await createUserClient(principal.userId, { clientName: principal.name });
  // Same per-request gate as the app's middleware: removed or deactivated users lose access.
  const { data: active, error } = await db.rpc("has_active_access");
  if (error || active !== true) return unauthorized(origin, "invalid_token");

  const response = await handleMcpRequest(request, { db, principal, origin });
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}

/** Stateless server: no server-initiated SSE stream and no sessions to delete. */
export function GET() {
  return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { allow: "POST" } });
}

export const DELETE = GET;

export function OPTIONS() {
  return corsPreflight();
}

function unauthorized(origin: string, error?: "invalid_token") {
  const params = [`resource_metadata="${mcpUrls(origin).resourceMetadata}"`];
  if (error) params.unshift(`error="${error}"`);
  return jsonResponse(
    { error: "UNAUTHORIZED" },
    { status: 401, headers: { "www-authenticate": `Bearer ${params.join(", ")}` } },
  );
}
