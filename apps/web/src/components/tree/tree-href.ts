import type { PageSummary } from "@/server/pages";

/**
 * Links to pages: `/s/<spaceSlug>/p/<slug>-<shortId>` (docs/PLAN.md §9 T2.4). Space slugs and page
 * slugs are `[a-z0-9-]` (DB checks), so no encoding is needed.
 *
 * Local helper until the page route (T2.4) ships its own `pageHref`: once it exists, re-export or
 * replace this one so there is a single implementation. The route resolves pages by `shortId`
 * (the slug part only makes URLs readable and may be stale after a rename).
 */
export function pageHref(spaceSlug: string, page: Pick<PageSummary, "slug" | "shortId">): string {
  const ref = page.slug ? `${page.slug}-${page.shortId}` : page.shortId;
  return `/s/${spaceSlug}/p/${ref}`;
}

/** `shortId` of the page open at `pathname` inside the Space, or `null` (Space home, settings…). */
export function shortIdFromPathname(pathname: string, spaceSlug: string): string | null {
  const prefix = `/s/${spaceSlug}/p/`;
  if (!pathname.startsWith(prefix)) return null;
  const ref = pathname.slice(prefix.length).split("/")[0] ?? "";
  const shortId = ref.slice(ref.lastIndexOf("-") + 1);
  return /^[0-9A-Za-z]{8}$/.test(shortId) ? shortId : null;
}
