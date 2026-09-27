import type { Locale } from "@kb/i18n";
import { z } from "zod";

import changelog from "@/generated/changelog.json";
import { appInfo, webEnv, type AppInfo } from "@/lib/env";

/**
 * Release information for the What's new page, the sidebar footer and Settings › About
 * (task T0.6b, docs/PLAN.md §6.3). Server-only.
 *
 * Data comes from `apps/web/src/generated/changelog.json`, generated before `dev`/`build`/`test`
 * by `scripts/release/build-changelog.mjs` from CHANGELOG.md (release-please, English) and
 * `changelog/vi/<version>.md`. Not committed; `[]` before the first release.
 */

/** One element of `changelog.json` (newest first) — see `ChangelogEntry` in scripts/release/changelog.mjs. */
export type ChangelogEntry = {
  version: string;
  /** `YYYY-MM-DD` written by release-please (UTC); `null` if the heading had no date. */
  date: string | null;
  en: string;
  /** `null` when that version has no Vietnamese notes. */
  vi: string | null;
};

/** Notes of one version in the reader's language. */
export type ReleaseNotes = {
  version: string;
  date: string | null;
  /** Markdown (no raw HTML), rendered by `ReleaseNotesMarkdown`. */
  markdown: string;
  /** Language of `markdown`: differs from the requested locale when that translation is missing. */
  language: Locale;
  /** `true` → show the "only available in English" label (PLAN §6.3 fallback). */
  isFallback: boolean;
};

/**
 * Picks the notes of each version in `locale`, falling back to English when a (usually old)
 * version has no Vietnamese notes. Versions without any user-facing notes are kept so the list
 * still shows that the release happened.
 *
 * @example
 * releaseNotesFor([{ version: "0.2.0", date: "2026-10-12", en: "### Added\n\n* Spaces", vi: null }], "vi")
 * // [{ version: "0.2.0", date: "2026-10-12", markdown: "### Added\n\n* Spaces", language: "en", isFallback: true }]
 */
export function releaseNotesFor(
  entries: readonly ChangelogEntry[],
  locale: Locale,
): ReleaseNotes[] {
  return entries.map(({ version, date, en, vi }) => {
    const useVi = locale === "vi" && vi !== null;
    return {
      version,
      date,
      markdown: useVi ? vi : en,
      language: useVi ? "vi" : "en",
      isFallback: locale === "vi" && !useVi,
    };
  });
}

/** Every released version, newest first, in `locale`. */
export function getReleaseNotes(locale: Locale): ReleaseNotes[] {
  return releaseNotesFor(changelog as ChangelogEntry[], locale);
}

const collabHealthSchema = z.object({
  version: z.string(),
  sha: z.string(),
  schemaVersion: z.number().int(),
});
export type CollabInfo = z.infer<typeof collabHealthSchema>;

export type AboutInfo = AppInfo & {
  /** From kb-collab `GET /health`; `null` when collab is not configured or unreachable. */
  collab: CollabInfo | null;
};

const COLLAB_TIMEOUT_MS = 2_000;

/**
 * Build identity of kb-web plus kb-collab's version for Settings › About. Never throws.
 *
 * @example
 * await getAboutInfo()
 * // { version: "0.1.0", sha: "3f2c9e1…", env: "staging",
 * //   collab: { version: "0.1.0", sha: "3f2c9e1…", schemaVersion: 1 } }
 */
export async function getAboutInfo(fetchImpl: typeof fetch = fetch): Promise<AboutInfo> {
  return { ...appInfo(), collab: await fetchCollabInfo(fetchImpl) };
}

async function fetchCollabInfo(fetchImpl: typeof fetch): Promise<CollabInfo | null> {
  let baseUrl: string | undefined;
  try {
    baseUrl = webEnv().COLLAB_INTERNAL_URL;
  } catch {
    return null;
  }
  if (!baseUrl) return null;
  try {
    // 503 ("degraded", database down) still carries the version.
    const res = await fetchImpl(new URL("/health", baseUrl), {
      cache: "no-store",
      signal: AbortSignal.timeout(COLLAB_TIMEOUT_MS),
    });
    const parsed = collabHealthSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
