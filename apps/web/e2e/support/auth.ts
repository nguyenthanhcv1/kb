import { createServerClient } from "@supabase/ssr";

import { baseUrl, type E2ELocale } from "./env";

export type SupabaseEnv = { url: string; anonKey: string; serviceKey: string };
export type Cookie = { name: string; value: string; url: string };

/** Calls the Supabase API with the service role (Auth admin API, PostgREST). Throws on non-2xx. */
export async function adminFetch(env: SupabaseEnv, path: string, init: RequestInit = {}) {
  const response = await fetch(`${env.url}${path}`, {
    ...init,
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response;
}

/**
 * Lets an email sign in: the sign-in hook only admits emails on `access_allowlist` (or with a
 * pending invitation). Idempotent.
 */
export async function allowEmail(env: SupabaseEnv, email: string) {
  await adminFetch(env, "/rest/v1/access_allowlist?on_conflict=kind,value", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ kind: "email", value: email, note: "e2e" }),
  });
}

/** Creates a confirmed email+password user (enabled in `supabase/config.toml`, local/CI only). */
export async function createUser(
  env: SupabaseEnv,
  user: { email: string; password: string; name: string },
) {
  await adminFetch(env, "/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: { full_name: user.name },
    }),
  });
}

/**
 * Signs in with email+password and returns the session cookies exactly as `@supabase/ssr` writes
 * them, ready for `context.addCookies`, plus the locale cookie.
 */
export async function signInCookies(
  env: SupabaseEnv,
  credentials: { email: string; password: string },
  locale: E2ELocale,
): Promise<Cookie[]> {
  const url = baseUrl();
  const jar = new Map<string, string>();
  const client = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await client.auth.signInWithPassword(credentials);
  if (error) throw error;
  return [
    ...[...jar].map(([name, value]) => ({ name, value, url })),
    { name: "NEXT_LOCALE", value: locale, url },
  ];
}
