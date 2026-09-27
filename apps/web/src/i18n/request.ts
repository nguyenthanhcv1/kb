import { defaultTimeZone, formats, loadMessages, localeCookieName, resolveLocale } from "@kb/i18n";
import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { getRequestPreferences } from "@/server/profile/request";

/**
 * next-intl request config (docs/PLAN.md §5.1). No locale in the URL: the locale comes from
 * `profiles.locale` → `NEXT_LOCALE` cookie → `Accept-Language` → `vi`, so a signed-in user gets
 * their saved language on any device. Time zone: `profiles.time_zone`, else `Asia/Ho_Chi_Minh`.
 */
export default getRequestConfig(async () => {
  const [cookieStore, headerStore, preferences] = await Promise.all([
    cookies(),
    headers(),
    getRequestPreferences(),
  ]);
  const locale = resolveLocale({
    profileLocale: preferences?.locale,
    cookieLocale: cookieStore.get(localeCookieName)?.value,
    acceptLanguage: headerStore.get("accept-language"),
  });
  return {
    locale,
    timeZone: preferences?.timeZone ?? defaultTimeZone,
    now: new Date(),
    formats,
    messages: await loadMessages(locale),
  };
});
