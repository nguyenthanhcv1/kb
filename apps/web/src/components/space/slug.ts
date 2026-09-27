/** Same rule as the DB check on `spaces.slug` and the zod schema of the Space contract. */
export const SPACE_SLUG_PATTERN = /^[a-z0-9-]{2,50}$/;
export const SPACE_SLUG_MAX_LENGTH = 50;

/** Whether `slug` can be sent to `createSpace` / `updateSpace` as is. */
export function isValidSpaceSlug(slug: string): boolean {
  return SPACE_SLUG_PATTERN.test(slug);
}

/**
 * Suggests a slug from a Space name: strips Vietnamese diacritics ("Kỹ thuật" → "ky-thuat",
 * "đ" → "d"), lower-cases, turns every run of other characters into one hyphen and cuts at 50
 * characters. May return a string shorter than 2 characters (e.g. for "A" or "🎨"): the form then
 * shows the validation message and the user types a slug.
 */
export function deriveSpaceSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Mn}+/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SPACE_SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
}

/** Normalizes what the user types in the slug field (lower-case, spaces → hyphens). */
export function normalizeSlugInput(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "-");
}
