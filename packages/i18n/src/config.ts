/** Supported UI locales. Vietnamese is the default and the source of truth for message types. */
export const locales = ["vi", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "vi";

/** Default IANA time zone when the user has not chosen one (`profiles.time_zone`). */
export const defaultTimeZone = "Asia/Ho_Chi_Minh";

/** Cookie holding the locale for signed-out screens (login, invite). */
export const localeCookieName = "NEXT_LOCALE";

/**
 * Every message namespace (one JSON file per namespace per locale, see docs/PLAN.md §5.2).
 * Order is alphabetical. Any task may add keys to any namespace (docs/ai/WORKFLOW.md §5).
 */
export const namespaces = [
  "admin",
  "audit",
  "auth",
  "common",
  "editor",
  "email",
  "errors",
  "history",
  "members",
  "nav",
  "search",
  "settings",
  "space",
  "table",
  "tree",
  "whatsNew",
] as const;
export type Namespace = (typeof namespaces)[number];

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

export function isNamespace(value: unknown): value is Namespace {
  return typeof value === "string" && (namespaces as readonly string[]).includes(value);
}
