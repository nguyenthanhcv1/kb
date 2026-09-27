import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

import type { CollabEnv } from "./env";
import { CollabAuthError } from "./errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Document names are `page:<uuid>` (docs/PLAN.md §1.2). Returns the page id or null. */
export function parseDocumentName(documentName: string): string | null {
  const match = /^page:(.+)$/.exec(documentName);
  return match && UUID.test(match[1]!) ? match[1]!.toLowerCase() : null;
}

export type AccessTokenVerifier = (token: string) => Promise<{ userId: string }>;

/**
 * Verifies a Supabase Auth access token (HS256 secret, or JWKS for asymmetric keys) and returns
 * the user id. Only `role: authenticated` tokens are accepted — never anon or service_role.
 */
export function createAccessTokenVerifier(
  env: Pick<CollabEnv, "SUPABASE_JWT_SECRET" | "SUPABASE_JWKS_URL">,
): AccessTokenVerifier {
  let key: Uint8Array | JWTVerifyGetKey;
  if (env.SUPABASE_JWKS_URL) key = createRemoteJWKSet(new URL(env.SUPABASE_JWKS_URL));
  else if (env.SUPABASE_JWT_SECRET) key = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
  else throw new Error("SUPABASE_JWT_SECRET or SUPABASE_JWKS_URL is required to verify tokens");

  return async (token) => {
    if (!token) throw new CollabAuthError("UNAUTHORIZED");
    try {
      const { payload } = await jwtVerify(token, key as Uint8Array, {
        algorithms: env.SUPABASE_JWKS_URL ? ["RS256", "ES256"] : ["HS256"],
        requiredClaims: ["sub", "exp"],
      });
      if (
        payload.role !== "authenticated" ||
        typeof payload.sub !== "string" ||
        !UUID.test(payload.sub)
      ) {
        throw new CollabAuthError("UNAUTHORIZED");
      }
      return { userId: payload.sub.toLowerCase() };
    } catch (error) {
      if (error instanceof CollabAuthError) throw error;
      throw new CollabAuthError("UNAUTHORIZED");
    }
  };
}

/** `https://kb-pr-*.thanhgo.com` style patterns; an empty list allows every origin. */
export function createOriginCheck(
  allowedOrigins: string | undefined,
): (origin: string | null) => boolean {
  const patterns = (allowedOrigins ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean)
    .map(
      (value) =>
        new RegExp(
          `^${value.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[a-z0-9-]+")}$`,
          "i",
        ),
    );
  if (patterns.length === 0) return () => true;
  return (origin) => origin !== null && patterns.some((pattern) => pattern.test(origin));
}
