import type viAuth from "@kb/i18n/messages/vi/auth.json";

import { baseUrl, e2eLocale, supabaseEnv } from "../support/env";
import { message } from "../support/messages";
import { contextFor, createTestUser } from "../support/space";
import { expect, test } from "../support/test";

/**
 * T7.7 — the login page uses the real Supabase auth: "Continue with Google" starts the Supabase
 * OAuth flow (authorize → Google, back to `/auth/callback` with `next`), and a signed-in user
 * opening `/login` goes straight on. Google itself is never reached: the request is stopped.
 */
const locale = e2eLocale();
const m = message<typeof viAuth>(locale, "auth");

test("Continue with Google starts the Supabase OAuth flow", async ({ page, context }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseUrl() }]);
  await context.route(/accounts\.google\.com/, (route) => route.abort());
  await page.goto("/login?next=%2Fsettings");

  const authorize = page.waitForRequest(/\/auth\/v1\/authorize\?/);
  await page.getByRole("button", { name: m.login.google }).click();
  const url = new URL((await authorize).url());
  expect(url.searchParams.get("provider")).toBe("google");
  const redirectTo = new URL(url.searchParams.get("redirect_to")!);
  expect(redirectTo.pathname).toBe("/auth/callback");
  expect(redirectTo.searchParams.get("next")).toBe("/settings");
});

test("a signed-in user opening the login page goes on", async ({ browser }) => {
  test.skip(!supabaseEnv(), "E2E_SUPABASE_* is not set (creates the user)");
  const context = await contextFor(browser, await createTestUser("login"));
  const page = await context.newPage();
  await page.goto("/login?next=%2Fsettings");
  await expect(page).toHaveURL(/\/settings$/);
  await context.close();
});
