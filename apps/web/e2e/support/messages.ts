import { createRequire } from "node:module";

import type { E2ELocale } from "./env";

const require = createRequire(import.meta.url);

/**
 * Loads one namespace of the message files so specs assert on real labels instead of literals
 * (they follow wording changes and work in both locales): `message("en", "space")`.
 */
export function message<T = Record<string, unknown>>(locale: E2ELocale, namespace: string): T {
  return require(`@kb/i18n/messages/${locale}/${namespace}.json`) as T;
}
