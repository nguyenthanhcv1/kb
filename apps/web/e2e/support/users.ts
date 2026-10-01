import path from "node:path";

import { adminFetch } from "./auth";
import { type E2ELocale, supabaseEnv } from "./env";

/** Number of pre-created internal users: one per Playwright worker (`TEST_PARALLEL_INDEX`). */
export const E2E_USER_COUNT = 4;
export const AUTH_DIR = path.join(import.meta.dirname, "..", ".auth");

export const workerEmail = (index: number | string) => `e2e-w${index}@kb.test`;
export const workerStorageState = (index: number | string) =>
  path.join(AUTH_DIR, `worker-${index}.json`);

/**
 * Email of the internal user this worker is signed in as, or undefined when the run brings its own
 * session (`E2E_STORAGE_STATE` without `E2E_AUTH_DIR`).
 */
export function currentUserEmail(): string | undefined {
  const index = process.env.TEST_PARALLEL_INDEX;
  return process.env.E2E_AUTH_DIR && index !== undefined ? workerEmail(index) : undefined;
}

/**
 * Sets `profiles.locale`. The profile wins over the `NEXT_LOCALE` cookie (docs/PLAN.md §5.1), so a
 * spec that asserts in a given language must set the profile too, not only the cookie. Defaults to
 * the worker's own user; no-op without a local Supabase or for a user the run does not own.
 */
export async function setProfileLocale(locale: E2ELocale, email = currentUserEmail()) {
  const env = supabaseEnv();
  if (!env || !email) return;
  await adminFetch(env, `/rest/v1/profiles?email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ locale }),
  });
}
