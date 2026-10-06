import { createAdminClient } from "@/lib/supabase/admin";
import { corsPreflight, jsonResponse, readParams } from "@/server/mcp/http";
import { exchangeAuthorizationCode, OAuthError, refreshTokens } from "@/server/mcp/oauth";

export const dynamic = "force-dynamic";

/** Token endpoint (RFC 6749 §3.2): authorization_code + PKCE, refresh_token (rotating). */
export async function POST(request: Request) {
  const params = await readParams(request);
  const db = createAdminClient();
  try {
    if (params.grant_type === "authorization_code") {
      return jsonResponse(
        await exchangeAuthorizationCode(db, {
          code: params.code,
          clientId: params.client_id,
          redirectUri: params.redirect_uri,
          codeVerifier: params.code_verifier,
        }),
      );
    }
    if (params.grant_type === "refresh_token") {
      return jsonResponse(
        await refreshTokens(db, { refreshToken: params.refresh_token, clientId: params.client_id }),
      );
    }
    throw new OAuthError("unsupported_grant_type");
  } catch (error) {
    const oauth =
      error instanceof OAuthError ? error : new OAuthError("server_error", undefined, 500);
    if (oauth.status >= 500) console.error("[oauth] token endpoint failed", error);
    return jsonResponse(oauth.toJSON(), { status: oauth.status });
  }
}

export function OPTIONS() {
  return corsPreflight();
}
