import type { BrowserContext } from "@playwright/test";

import { baseUrl, type E2ELocale } from "./env";
import { setProfileLocale } from "./users";

/**
 * Makes the UI of `context` render in `locale`: the `NEXT_LOCALE` cookie (signed-out pages) and the
 * signed-in user's profile (which takes priority). Use it instead of adding the cookie by hand.
 */
export async function useLocale(context: BrowserContext, locale: E2ELocale, email?: string) {
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseUrl() }]);
  await setProfileLocale(locale, email);
}
