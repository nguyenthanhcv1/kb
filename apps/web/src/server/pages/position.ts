/**
 * Fractional index keys for sibling order (`pages.position`, compared with collate "C").
 *
 * Keys are base62 strings read as fractions in [0, 1): `"V"` ≈ 0.5, `"a"` > `"Z"` > `"9"`.
 * Any two keys have a key strictly between them, so a move rewrites a single row. Keys never
 * end in `"0"` (that would leave no room before them). Appending bumps the last digit, so a key
 * grows by one character every ~31 appends (1 000 siblings → ≤ 34 chars); inserting between
 * two keys adds at most one character.
 *
 * Own implementation (the `fractional-indexing` package is CC0, outside the license allowlist).
 */

export const POSITION_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = POSITION_DIGITS.length;
const MID = POSITION_DIGITS[Math.floor(BASE / 2)]!;

export const POSITION_PATTERN = /^[0-9A-Za-z]*[1-9A-Za-z]$/;

function digit(char: string): number {
  const value = POSITION_DIGITS.indexOf(char);
  if (value < 0) throw new Error(`invalid position character ${JSON.stringify(char)}`);
  return value;
}

export function isValidPosition(key: string): boolean {
  return POSITION_PATTERN.test(key);
}

/** Byte-wise comparison, same as Postgres `collate "C"` for ASCII. */
export function comparePositions(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Midpoint of fractions `a` < `b` (digits after the point; `b = null` means 1). */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while (n < b.length && (a[n] ?? "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const low = a ? digit(a[0]!) : 0;
  const high = b !== null ? digit(b[0]!) : BASE;
  if (high - low > 1) return POSITION_DIGITS[Math.round((low + high) / 2)]!;
  // Adjacent digits: keep `a`'s first digit and go one level deeper.
  if (b !== null && b.length > 1) return b[0]!;
  return POSITION_DIGITS[low]! + midpoint(a.slice(1), null);
}

/** Key after `a`: bumps the last digit when possible, so appending stays short. */
function after(a: string): string {
  const last = digit(a[a.length - 1]!);
  if (last < BASE - 1) return a.slice(0, -1) + POSITION_DIGITS[last + 1]!;
  return a + MID;
}

/**
 * Key strictly between `before` and `after` (either may be null for "no neighbour").
 * `keyBetween(null, null)` = first key of an empty list.
 */
export function keyBetween(before: string | null, afterKey: string | null): string {
  for (const key of [before, afterKey]) {
    if (key !== null && !isValidPosition(key))
      throw new Error(`invalid position ${JSON.stringify(key)}`);
  }
  if (before !== null && afterKey !== null && comparePositions(before, afterKey) >= 0) {
    throw new Error(`${before} is not before ${afterKey}`);
  }
  if (before === null && afterKey === null) return MID;
  if (afterKey === null) return after(before!);
  return midpoint(before ?? "", afterKey);
}
