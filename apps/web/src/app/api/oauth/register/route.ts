import { createAdminClient } from "@/lib/supabase/admin";
import { corsPreflight, jsonResponse } from "@/server/mcp/http";
import { OAuthError, registerClient } from "@/server/mcp/oauth";

export const dynamic = "force-dynamic";

/** Dynamic client registration (RFC 7591) for claude.ai, ChatGPT and other MCP clients. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(new OAuthError("invalid_client_metadata").toJSON(), { status: 400 });
  }
  try {
    return jsonResponse(await registerClient(createAdminClient(), body), { status: 201 });
  } catch (error) {
    const oauth =
      error instanceof OAuthError ? error : new OAuthError("server_error", undefined, 500);
    return jsonResponse(oauth.toJSON(), { status: oauth.status });
  }
}

export function OPTIONS() {
  return corsPreflight();
}
