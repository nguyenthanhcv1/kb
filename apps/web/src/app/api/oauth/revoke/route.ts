import { createAdminClient } from "@/lib/supabase/admin";
import { corsPreflight, jsonResponse, readParams } from "@/server/mcp/http";
import { revokeToken } from "@/server/mcp/oauth";

export const dynamic = "force-dynamic";

/** Token revocation (RFC 7009): always 200, also for unknown tokens. */
export async function POST(request: Request) {
  const params = await readParams(request);
  try {
    await revokeToken(createAdminClient(), params.token);
  } catch (error) {
    console.error("[oauth] revoke failed", error);
    return jsonResponse({ error: "server_error" }, { status: 503 });
  }
  return jsonResponse({});
}

export function OPTIONS() {
  return corsPreflight();
}
