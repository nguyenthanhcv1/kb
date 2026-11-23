import { createBrowserClient } from "@supabase/ssr";

import { readPublicSupabaseConfig } from "./public-config";

/**
 * Supabase client for Client Components (Realtime subscriptions, uploads to signed URLs). The
 * URL and anon key come from the root layout at request time (see `./public-config`), so a
 * Docker image built without `NEXT_PUBLIC_*` still works. It reads the session from the auth
 * cookies the middleware keeps fresh, so requests run as the signed-in user and RLS applies.
 */
export function createClient() {
  const config = readPublicSupabaseConfig();
  if (!config) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY");
  return createBrowserClient(config.url, config.anonKey);
}
