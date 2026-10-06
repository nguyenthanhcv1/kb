import { publicOrigin } from "@/lib/public-origin";
import { authorizationServerMetadata, corsPreflight, jsonResponse } from "@/server/mcp/http";

export const dynamic = "force-dynamic";

/** OAuth authorization server metadata (RFC 8414) of the MCP connector. */
export function GET(request: Request) {
  return jsonResponse(authorizationServerMetadata(publicOrigin(request.url)));
}

export function OPTIONS() {
  return corsPreflight();
}
