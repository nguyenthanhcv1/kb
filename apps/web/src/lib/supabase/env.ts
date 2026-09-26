import { parseEmailList } from "@/server/auth/utils";

/**
 * Supabase connection settings read straight from `process.env`.
 * `apps/web/src/lib/env.ts` (claude-2, T0.7) will grow into the validated env schema for the
 * whole app; until then this file is the single place the auth server reads these three vars,
 * so `.env.example` only needs to gain them once that schema exists.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL");
}

export function supabaseAnonKey(): string {
  return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

/** Server-only; never expose to the browser bundle. Used for the bootstrap sync (T1.2a). */
export function supabaseServiceRoleKey(): string {
  return required("SUPABASE_SERVICE_ROLE_KEY");
}

/**
 * Comma-separated emails from `BOOTSTRAP_SUPER_ADMIN_EMAILS` — the one hardcoding exception in
 * AGENTS.md §"Quyết định kiến trúc": every other allow/deny decision lives in the DB.
 */
export function bootstrapSuperAdminEmails(): string[] {
  return parseEmailList(process.env.BOOTSTRAP_SUPER_ADMIN_EMAILS);
}
