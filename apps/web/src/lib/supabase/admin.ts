import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { supabaseServiceRoleKey, supabaseUrl } from "./env";

/**
 * Service-role client: bypasses RLS, has no user session/cookies. Server-only — importing this
 * from a Client Component would leak the service key into the browser bundle.
 * Used for the bootstrap super-admin sync (T1.2a); later tasks (T1.5a invites, T1.7a admin) reuse it.
 */
export function createAdminClient() {
  return createSupabaseClient(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
