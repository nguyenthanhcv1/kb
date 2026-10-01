import { mkdir, writeFile } from "node:fs/promises";

import { allowEmail, createUser, signInCookies } from "./support/auth";
import { baseUrl, e2eLocale, supabaseEnv } from "./support/env";
import { AUTH_DIR, E2E_USER_COUNT, workerEmail, workerStorageState } from "./support/users";

/**
 * Creates one signed-in internal user per Playwright worker (`e2e-w<N>@kb.test`, local/CI only —
 * email+password is off in production) and writes their storage states. `playwright.config.ts`
 * points each worker's `E2E_STORAGE_STATE` at its own user, so specs never share a profile (their
 * language / time zone are per profile). Without `E2E_SUPABASE_*` it does nothing and the specs
 * that need a session skip. An already set `E2E_STORAGE_STATE` wins (bring-your-own session).
 */
export default async function globalSetup() {
  const env = supabaseEnv();
  if (!env || process.env.E2E_STORAGE_STATE) return;

  const origin = new URL(baseUrl());
  await mkdir(AUTH_DIR, { recursive: true });
  for (let index = 0; index < E2E_USER_COUNT; index++) {
    const user = {
      email: workerEmail(index),
      password: `e2e-password-${index}`,
      name: `E2E Internal ${index}`,
    };
    await allowEmail(env, user.email);
    try {
      await createUser(env, user);
    } catch (error) {
      // Re-run against the same stack: the user already exists (GoTrue answers 422 email_exists).
      if (!String(error).includes("email_exists")) throw error;
    }
    const cookies = await signInCookies(env, user, e2eLocale());
    await writeFile(
      workerStorageState(index),
      JSON.stringify({
        cookies: cookies.map(({ name, value }) => ({
          name,
          value,
          domain: origin.hostname,
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: "Lax",
        })),
        origins: [],
      }),
    );
  }
  process.env.E2E_AUTH_DIR = AUTH_DIR;
  process.env.E2E_STORAGE_STATE = workerStorageState(0);
}
