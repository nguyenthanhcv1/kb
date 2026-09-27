import { defaultTimeZone } from "@kb/i18n/config";

/**
 * IANA time zone helpers for `profiles.time_zone` (task T1.3). Pure functions, safe to import from
 * client components (the settings form detects the browser zone with {@link normalizeTimeZone}).
 */

/**
 * ICU still lists some zones under their legacy CLDR ids (`Intl.supportedValuesOf("timeZone")`
 * returns `Asia/Saigon`, not `Asia/Ho_Chi_Minh`). Both are valid; we store and show the current
 * IANA name so the default (`Asia/Ho_Chi_Minh`) and the list agree.
 */
const LEGACY_TIME_ZONE_IDS: Readonly<Record<string, string>> = {
  "America/Godthab": "America/Nuuk",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

/** `Area/Location[/Sub]` or `UTC`, case-sensitive like the IANA database. */
const TIME_ZONE_SHAPE = /^(?:UTC|[A-Z][A-Za-z_]*(?:\/[A-Za-z0-9_+-]+){1,2})$/;

/** True when `value` is an IANA time zone name the runtime's `Intl` understands. */
export function isValidTimeZone(value: string): boolean {
  if (value.length > 64 || !TIME_ZONE_SHAPE.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Current IANA name for a legacy id (`Asia/Saigon` → `Asia/Ho_Chi_Minh`); other values unchanged. */
export function normalizeTimeZone(value: string): string {
  return LEGACY_TIME_ZONE_IDS[value] ?? value;
}

export type TimeZoneOption = {
  /** IANA name stored in `profiles.time_zone`. */
  id: string;
  /** UTC offset at `now`, e.g. `GMT+07:00` (`GMT+00:00` for UTC itself). */
  offset: string;
  /** Offset in minutes at `now` (sort key). */
  offsetMinutes: number;
};

function offsetOf(timeZone: string, now: Date): { offset: string; offsetMinutes: number } {
  const part = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")?.value;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(part ?? "");
  // Zero offset comes back as plain `GMT` in browsers, `GMT+00:00` in some ICU builds.
  if (!match) return { offset: "GMT+00:00", offsetMinutes: 0 };
  const sign = match[1] === "-" ? -1 : 1;
  return { offset: match[0], offsetMinutes: sign * (Number(match[2]) * 60 + Number(match[3])) };
}

/**
 * Every time zone the runtime supports (plus `UTC`, the app default and `include`), deduplicated
 * after {@link normalizeTimeZone}, sorted by UTC offset then name. Offsets depend on `now` (DST),
 * so the list is built on the server and passed to the form (no hydration mismatch).
 */
export function listTimeZones(now: Date, include: readonly string[] = []): TimeZoneOption[] {
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const ids = new Set<string>();
  for (const id of [...supported, "UTC", defaultTimeZone, ...include]) {
    const normalized = normalizeTimeZone(id);
    if (isValidTimeZone(normalized)) ids.add(normalized);
  }
  return [...ids]
    .map((id) => ({ id, ...offsetOf(id, now) }))
    .sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.id.localeCompare(b.id));
}
