import { publicOrigin } from "@/lib/public-origin";
import { corsPreflight, jsonResponse, protectedResourceMetadata } from "@/server/mcp/http";

export const dynamic = "force-dynamic";

/**
 * Protected resource metadata (RFC 9728) of `/api/mcp`, at the path-suffixed URL the MCP spec
 * uses (`/.well-known/oauth-protected-resource/api/mcp`) and at the bare one.
 */
export function GET(request: Request) {
  return jsonResponse(protectedResourceMetadata(publicOrigin(request.url)));
}

export function OPTIONS() {
  return corsPreflight();
}
