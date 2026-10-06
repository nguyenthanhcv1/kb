import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";

import { webEnv } from "@/lib/env";

/**
 * Supabase client acting as a user without a browser session (MCP connector). Server-only.
 *
 * kb-web signs a short-lived `authenticated` JWT for the user with the project's HS256 secret,
 * so PostgREST applies RLS (and audit triggers record the user) exactly as for a request from
 * the app. `auth.getUser()` answers locally: the token is ours, not a GoTrue session, and the
 * existing server contracts (`listSpaces`, …) only read the user id from it.
 */

/** Lifetime of the signed JWT; one is minted per MCP request. */
export const USER_JWT_TTL_SECONDS = 5 * 60;

export class UserClientNotConfiguredError extends Error {
  constructor() {
    super("SUPABASE_JWT_SECRET is not set");
    this.name = "UserClientNotConfiguredError";
  }
}

export interface UserClientOptions {
  /** Defaults to the validated environment. */
  url?: string;
  anonKey?: string;
  jwtSecret?: string;
  /** Marks requests made through the connector (`x-kb-client` header, server logs). */
  clientName?: string;
}

export async function signUserJwt(
  userId: string,
  secret: string,
  now: Date = new Date(),
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({
    role: "authenticated",
    aal: "aal1",
    amr: [{ method: "mcp", timestamp: issuedAt }],
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setAudience("authenticated")
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + USER_JWT_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret));
}

export function isUserClientConfigured(): boolean {
  return Boolean(webEnv().SUPABASE_JWT_SECRET);
}

export async function createUserClient(
  userId: string,
  options: UserClientOptions = {},
): Promise<SupabaseClient> {
  const env = options.url && options.anonKey && options.jwtSecret ? null : webEnv();
  const secret = options.jwtSecret ?? env?.SUPABASE_JWT_SECRET;
  if (!secret) throw new UserClientNotConfiguredError();
  const token = await signUserJwt(userId, secret);

  const client = createClient(
    options.url ?? env!.SUPABASE_URL,
    options.anonKey ?? env!.SUPABASE_ANON_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.clientName ? { "x-kb-client": options.clientName } : {}),
        },
      },
    },
  );

  const user = { id: userId };
  const auth = withOverride(client.auth, "getUser", async () => ({ data: { user }, error: null }));
  return withOverride(client, "auth", auth);
}

/** `target` with one property replaced; methods stay bound to the real object. */
function withOverride<T extends object>(target: T, key: PropertyKey, value: unknown): T {
  return new Proxy(target, {
    get(object, property) {
      if (property === key) return value;
      const member = Reflect.get(object, property, object) as unknown;
      return typeof member === "function"
        ? (member as (...a: unknown[]) => unknown).bind(object)
        : member;
    },
  });
}
