const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * Turns what a user typed into a safe link `href`, or `null` when it cannot be one.
 * "example.com/a" → "https://example.com/a"; `javascript:` and other schemes are refused.
 */
export function normalizeLinkHref(input: string): string | null {
  const value = input.trim();
  if (!value || /\s/.test(value)) return null;
  if (value.startsWith("/") || value.startsWith("#")) return value;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  const candidate = hasScheme ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (!SAFE_PROTOCOLS.has(url.protocol)) return null;
    if ((url.protocol === "http:" || url.protocol === "https:") && !url.hostname.includes(".")) {
      return url.hostname === "localhost" ? url.href : null;
    }
    return hasScheme ? value : url.href;
  } catch {
    return null;
  }
}

/** Image `src` typed by a user: only absolute http(s) URLs (base64 and other schemes refused). */
export function normalizeImageSrc(input: string): string | null {
  const value = input.trim();
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
