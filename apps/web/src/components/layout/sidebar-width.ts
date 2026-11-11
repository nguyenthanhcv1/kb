/**
 * Width of the desktop sidebar (px), chosen by dragging its edge and kept in a cookie so the
 * server renders the chosen width right away (no jump after hydration). Pure and client-safe.
 *
 * ```ts
 * parseSidebarWidth(undefined); // 288 (default)
 * parseSidebarWidth("1000");    // 480 (clamped)
 * parseSidebarWidth("abc");     // 288
 * ```
 */
export const SIDEBAR_WIDTH_COOKIE = "kb_sidebar_width";
export const SIDEBAR_WIDTH_DEFAULT = 288;
export const SIDEBAR_WIDTH_MIN = 224;
export const SIDEBAR_WIDTH_MAX = 480;
/** Arrow-key step of the resize handle. */
export const SIDEBAR_WIDTH_STEP = 16;

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.round(Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, width)));
}

/** Width stored in the cookie, or the default when missing/invalid. */
export function parseSidebarWidth(value: string | undefined | null): number {
  if (!value || !/^\d{2,4}$/.test(value)) return SIDEBAR_WIDTH_DEFAULT;
  return clampSidebarWidth(Number(value));
}

/** Persist the width for one year (client only). */
export function storeSidebarWidth(width: number): void {
  document.cookie = `${SIDEBAR_WIDTH_COOKIE}=${clampSidebarWidth(width)}; path=/; max-age=31536000; samesite=lax`;
}
