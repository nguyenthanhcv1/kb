import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components (Realtime subscriptions). `NEXT_PUBLIC_*` variables must
 * be read as literal `process.env.X` for Next.js to inline them into the browser bundle, so this
 * cannot reuse the dynamic lookups of `./env`. It reads the session from the auth cookies the
 * middleware keeps fresh, so subscriptions run as the signed-in user and RLS applies.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY");
  return createBrowserClient(url, anonKey);
}
