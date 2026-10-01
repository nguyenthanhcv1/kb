/**
 * Environment of the E2E run (T7.1b). Everything is optional so `pnpm exec playwright test` still
 * works against any running app: specs that need more skip themselves (see `test.skip` at the top
 * of each spec). CI (`.github/workflows/e2e.yml`) sets all of it.
 */
export type E2ELocale = "vi" | "en";

export function e2eLocale(): E2ELocale {
  const value = process.env.E2E_LOCALE ?? "vi";
  if (value !== "vi" && value !== "en") {
    throw new Error(`E2E_LOCALE must be "vi" or "en", got "${value}"`);
  }
  return value;
}

export function baseUrl(): string {
  return process.env.E2E_BASE_URL ?? "http://localhost:3000";
}

/** Local Supabase stack (`supabase status -o env`); undefined when the run has none. */
export function supabaseEnv(): { url: string; anonKey: string; serviceKey: string } | undefined {
  const url = process.env.E2E_SUPABASE_URL;
  const anonKey = process.env.E2E_SUPABASE_ANON_KEY;
  const serviceKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  return url && anonKey && serviceKey ? { url, anonKey, serviceKey } : undefined;
}
