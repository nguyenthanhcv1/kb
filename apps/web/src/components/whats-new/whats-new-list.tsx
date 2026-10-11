"use client";

import { InfoIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { cn } from "@/components/ui/utils";
import type { ReleaseNotes } from "@/server/release";

import { ReleaseNotesMarkdown } from "./release-notes-markdown";
import { type SectionKind, splitReleaseSections } from "./release-sections";

type Filter = "all" | Exclude<SectionKind, "other">;

const FILTERS: readonly Filter[] = ["all", "features", "improvements", "fixes"];

/**
 * Released versions, newest first, each with its date and notes in the reader's language. The
 * chips narrow the notes to one kind of change (sections are told apart by their `###` heading);
 * a version without a matching section is hidden while a chip is on.
 */
export function WhatsNewList({ releases }: { releases: readonly ReleaseNotes[] }) {
  const t = useTranslations("whatsNew");
  const format = useFormatter();
  const [filter, setFilter] = useState<Filter>("all");

  if (releases.length === 0) {
    return <p className="text-muted-foreground">{t("empty")}</p>;
  }

  const visible = releases.flatMap((release, index) => {
    const markdown =
      filter === "all"
        ? release.markdown
        : splitReleaseSections(release.markdown)
            .filter((section) => section.kind === filter)
            .map((section) => section.markdown)
            .join("\n\n");
    return filter === "all" || markdown.trim() ? [{ release, markdown, latest: index === 0 }] : [];
  });

  return (
    <div className="flex flex-col gap-5">
      <div role="group" aria-label={t("filterLabel")} className="flex flex-wrap gap-2">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              "rounded-full border bg-card px-3.5 py-1.5 text-[13px] font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              filter === value
                ? "border-primary bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(value)}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="rounded-[10px] border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("noMatch")}
        </p>
      ) : (
        <ol className="flex flex-col gap-5">
          {visible.map(({ release, markdown, latest }) => {
            const headingId = `release-${release.version.replace(/[^0-9A-Za-z-]/g, "-")}`;
            return (
              <li key={release.version}>
                <article
                  aria-labelledby={headingId}
                  className="rounded-[10px] border bg-card p-5 text-card-foreground sm:p-6"
                >
                  <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h2 id={headingId} className="font-mono text-lg font-bold">
                      {t("version", { version: release.version })}
                    </h2>
                    {latest && (
                      <span className="rounded bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">
                        {t("latest")}
                      </span>
                    )}
                    {release.date && (
                      <p className="ml-auto text-sm text-muted-foreground">
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
                  {markdown.trim() ? (
                    <ReleaseNotesMarkdown lang={release.language} className="mt-4 text-sm">
                      {markdown}
                    </ReleaseNotesMarkdown>
                  ) : (
                    <p className="mt-4 text-sm text-muted-foreground">{t("noNotes")}</p>
                  )}
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
