import { pageHref, parsePageRef } from "@/lib/page-href";

/** Links to pages come from the page route's helper (T2.4) so there is one implementation. */
export { pageHref };

/** `shortId` of the page open at `pathname` inside the Space, or `null` (Space home, settings…). */
export function shortIdFromPathname(pathname: string, spaceSlug: string): string | null {
  const prefix = `/s/${spaceSlug}/p/`;
  if (!pathname.startsWith(prefix)) return null;
  const ref = pathname.slice(prefix.length).split("/")[0] ?? "";
  return parsePageRef(ref)?.shortId ?? null;
}
