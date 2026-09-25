/**
 * Folds Vietnamese text for accent-insensitive matching: NFD → strip combining marks →
 * `đ/Đ` → `d` → lowercase. Mirrors `app.vn_unaccent` in Postgres so client-side filtering
 * (quick switcher, highlight, slugs) agrees with server search.
 *
 * @example normalizeVi("Nghỉ Phép Đặc Biệt") // "nghi phep dac biet"
 */
export function normalizeVi(input: string): string {
  return input.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
}

/**
 * URL-safe slug from any (Vietnamese) text: normalizeVi → non-alphanumerics become `-`.
 *
 * @example slugifyVi("Quy trình nghỉ phép 2026") // "quy-trinh-nghi-phep-2026"
 */
export function slugifyVi(input: string): string {
  return normalizeVi(input)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Shared named formats for next-intl (`format.dateTime(date, "dateShort")`,
 * `format.number(n, "bytes")`). Relative time uses `format.relativeTime` and needs no preset.
 */
export const formats = {
  dateTime: {
    dateShort: { day: "2-digit", month: "2-digit", year: "numeric" },
    dateTime: {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
    time: { hour: "2-digit", minute: "2-digit" },
  },
  number: {
    number: { maximumFractionDigits: 2 },
    percent: { style: "percent", maximumFractionDigits: 1 },
    bytes: { notation: "compact", style: "unit", unit: "byte", unitDisplay: "narrow" },
  },
} satisfies {
  // Structurally equal to next-intl's `Formats`, without depending on next-intl here.
  dateTime: Record<string, Intl.DateTimeFormatOptions>;
  number: Record<string, Intl.NumberFormatOptions>;
};
