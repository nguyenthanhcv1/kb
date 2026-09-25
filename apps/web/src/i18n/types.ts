import type { formats, Locale, Messages } from "@kb/i18n";

// Type-safe `t("namespace.key")`, `useLocale()` and named formats across the app.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
    Formats: typeof formats;
  }
}
