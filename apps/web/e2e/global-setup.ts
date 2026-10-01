import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { allowEmail, createUser, signInCookies } from "./support/auth";
import { baseUrl, e2eLocale, supabaseEnv } from "./support/env";

/** Shared internal test user. Local/CI only (email+password is off in production). */
const USER = {
  email: "e2e-internal@kb.test",
  password: "e2e-internal-password",
  name: "E2E Internal",
};

export const STORAGE_STATE_PATH = path.join(import.meta.dirname, "..", ".auth", "internal.json");

/**
 * Creates (once) a signed-in internal user and exports `E2E_STORAGE_STATE` for the specs that
 * need one. Without `E2E_SUPABASE_*` it does nothing and those specs skip, as before T7.1b.
 * An already set `E2E_STORAGE_STATE` wins (bring-your-own session).
 */
export default async function globalSetup() {
  const env = supabaseEnv();
  if (!env || process.env.E2E_STORAGE_STATE) return;

  await allowEmail(env, USER.email);
  try {
    await createUser(env, USER);
  } catch (error) {
    // Re-run against the same stack: the user already exists (GoTrue answers 422 email_exists).
    if (!String(error).includes("email_exists")) throw error;
  }
  const cookies = await signInCookies(env, USER, e2eLocale());
  const origin = new URL(baseUrl());
  await mkdir(path.dirname(STORAGE_STATE_PATH), { recursive: true });
  await writeFile(
    STORAGE_STATE_PATH,
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
  process.env.E2E_STORAGE_STATE = STORAGE_STATE_PATH;
}
