import { defaultLocale, defaultTimeZone, loadMessages, type Locale, type Messages } from "@kb/i18n";
import { createTranslator } from "next-intl";

export type ShellIntl = { locale: Locale; timeZone: string; messages: Messages };

/**
 * Locale, time zone and messages for the root layout.
 * Temporary: always the default locale until T0.3b wires next-intl request config
 * (cookie → Accept-Language → vi) and replaces this with `getLocale()` / `getMessages()`.
 */
export async function getShellIntl(): Promise<ShellIntl> {
  const locale = defaultLocale;
  return { locale, timeZone: defaultTimeZone, messages: await loadMessages(locale) };
}

/** Translator for the `common` namespace in Server Components (stand-in for `getTranslations`). */
export async function getCommonTranslations() {
  const { locale, messages } = await getShellIntl();
  return createTranslator({ locale, messages, namespace: "common" });
}
