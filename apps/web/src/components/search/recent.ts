/** Recently opened search results, kept per browser (a convenience: every access is guarded). */
export type RecentPage = { href: string; title: string; icon: string | null; spaceName: string };

const KEY = "kb.search.recent";
const MAX = 6;

export function readRecent(): RecentPage[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const value: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is RecentPage =>
          !!item && typeof item.href === "string" && typeof item.title === "string",
      )
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function pushRecent(page: RecentPage): void {
  try {
    const next = [page, ...readRecent().filter((item) => item.href !== page.href)].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage unavailable: recent pages are optional
  }
}
