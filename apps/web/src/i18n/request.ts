import { defaultTimeZone, formats, loadMessages, localeCookieName, resolveLocale } from "@kb/i18n";
import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

/**
 * next-intl request config (docs/PLAN.md §5.1). No locale in the URL: the locale comes from
 * `profiles.locale` → `NEXT_LOCALE` cookie → `Accept-Language` → `vi`.
 * `profileLocale` / `profiles.time_zone` are wired once the profile is readable (T1.2a, T1.3).
 */
export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale({
    profileLocale: null,
    cookieLocale: cookieStore.get(localeCookieName)?.value,
    acceptLanguage: headerStore.get("accept-language"),
  });
  return {
    locale,
    timeZone: defaultTimeZone,
    now: new Date(),
    formats,
    messages: await loadMessages(locale),
  };
});
