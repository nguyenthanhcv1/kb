import { defaultLocale, isLocale, type Locale } from "./config";

export interface LocaleSources {
  /** `profiles.locale` of the signed-in user. */
  profileLocale?: string | null;
  /** Value of the `NEXT_LOCALE` cookie. */
  cookieLocale?: string | null;
  /** Raw `Accept-Language` request header. */
  acceptLanguage?: string | null;
}

/**
 * Picks the UI locale: profile → cookie → Accept-Language → `vi` (docs/PLAN.md §5.1).
 * Unknown values are ignored rather than rejected.
 */
export function resolveLocale(sources: LocaleSources): Locale {
  const { profileLocale, cookieLocale, acceptLanguage } = sources;
  if (isLocale(profileLocale)) return profileLocale;
  if (isLocale(cookieLocale)) return cookieLocale;
  return matchAcceptLanguage(acceptLanguage) ?? defaultLocale;
}

/**
 * Returns the best supported locale from an `Accept-Language` header, honouring q-values
 * and matching on the primary subtag (`en-US` → `en`). Returns `undefined` when nothing matches.
 */
export function matchAcceptLanguage(header: string | null | undefined): Locale | undefined {
  if (!header) return undefined;
  const ranges = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q === undefined ? 1 : Number(q.slice(2));
      return { tag: tag.trim().toLowerCase(), weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((range) => range.tag !== "" && range.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);

  for (const { tag } of ranges) {
    const primary = tag.split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return undefined;
}
