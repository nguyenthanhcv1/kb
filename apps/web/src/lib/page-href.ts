/**
 * URLs of pages and of the Space trash (T2.4). Pure and client-safe: used by the page route, the
 * sidebar tree (T2.3), search results, links in content…
 *
 * A page URL is `/s/<spaceSlug>/p/<slug>-<shortId>`. Only the 8-character `shortId` identifies
 * the page; the slug follows the title and may be outdated in old links — the page route then
 * redirects to {@link pageHref}.
 *
 * ```ts
 * pageHref("design", { slug: "huong-dan", shortId: "a1B2c3D4" }); // "/s/design/p/huong-dan-a1B2c3D4"
 * pageHref("design", { slug: "", shortId: "a1B2c3D4" });          // "/s/design/p/a1B2c3D4"
 * parsePageRef("huong-dan-cu-a1B2c3D4"); // { slug: "huong-dan-cu", shortId: "a1B2c3D4" }
 * ```
 */

/** Same check as the DB (`pages.short_id ~ '^[0-9A-Za-z]{8}$'`). */
const SHORT_ID = /^[0-9A-Za-z]{8}$/;

export type PageRefParts = { slug: string; shortId: string };

/** The `[pageRef]` URL segment of a page: `<slug>-<shortId>`, or just `<shortId>` when untitled. */
export function pageRef(page: PageRefParts): string {
  return page.slug ? `${page.slug}-${page.shortId}` : page.shortId;
}

/** Canonical URL of a page in the Space `spaceSlug`. */
export function pageHref(spaceSlug: string, page: PageRefParts): string {
  return `/s/${encodeURIComponent(spaceSlug)}/p/${encodeURIComponent(pageRef(page))}`;
}

/** URL of the trash of the Space `spaceSlug`. */
export function spaceTrashHref(spaceSlug: string): string {
  return `/s/${encodeURIComponent(spaceSlug)}/trash`;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Splits a `[pageRef]` segment into slug and short id: the short id is the last 8 characters,
 * after a `-` when there is a slug. Returns `null` when the segment cannot hold a short id.
 */
export function parsePageRef(ref: string): PageRefParts | null {
  const value = safeDecode(ref).trim();
  const dash = value.lastIndexOf("-");
  const shortId = dash < 0 ? value : value.slice(dash + 1);
  if (!SHORT_ID.test(shortId)) return null;
  return { slug: dash < 0 ? "" : value.slice(0, dash), shortId };
}

/**
 * Where the page route must send the visitor: `null` when `spaceSlug`/`ref` already are the
 * canonical URL of `page`, otherwise its canonical href (old slug after a rename, page moved to
 * another Space, missing slug…).
 */
export function canonicalPageRedirect(
  current: { spaceSlug: string; ref: string },
  page: PageRefParts & { spaceSlug: string },
): string | null {
  const sameSpace = safeDecode(current.spaceSlug) === page.spaceSlug;
  const sameRef = safeDecode(current.ref) === pageRef(page);
  return sameSpace && sameRef ? null : pageHref(page.spaceSlug, page);
}
