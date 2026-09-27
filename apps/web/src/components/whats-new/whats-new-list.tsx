import { InfoIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import type { ReleaseNotes } from "@/server/release";

import { ReleaseNotesMarkdown } from "./release-notes-markdown";

/** Released versions, newest first, each with its date and notes in the reader's language. */
export function WhatsNewList({ releases }: { releases: readonly ReleaseNotes[] }) {
  const t = useTranslations("whatsNew");
  const format = useFormatter();

  if (releases.length === 0) {
    return <p className="text-muted-foreground">{t("empty")}</p>;
  }

  return (
    <ol className="flex flex-col gap-6">
      {releases.map((release) => {
        const headingId = `release-${release.version.replace(/[^0-9A-Za-z-]/g, "-")}`;
        return (
          <li key={release.version}>
            <article
              aria-labelledby={headingId}
              className="rounded-xl border bg-card p-4 text-card-foreground shadow-xs sm:p-6"
            >
              <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 id={headingId} className="text-lg font-semibold">
                  {t("version", { version: release.version })}
                </h2>
                {release.date && (
                  <p className="text-sm text-muted-foreground">
                    <time dateTime={release.date}>
                      {t("releasedOn", {
                        // The date is a calendar day written by release-please in UTC.
                        date: format.dateTime(new Date(`${release.date}T00:00:00Z`), {
                          dateStyle: "long",
                          timeZone: "UTC",
                        }),
                      })}
                    </time>
                  </p>
                )}
              </header>
              {release.isFallback && (
                <p className="mt-3 flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                  <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {t("englishOnly")}
                </p>
              )}
              {release.markdown.trim() ? (
                <ReleaseNotesMarkdown lang={release.language} className="mt-4 text-sm">
                  {release.markdown}
                </ReleaseNotesMarkdown>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">{t("noNotes")}</p>
              )}
            </article>
          </li>
        );
      })}
    </ol>
  );
}
