"use client";

import type { JSONContent } from "@tiptap/core";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

import { BlockEditor } from "@/components/editor/block-editor";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/utils";
import type { PageVersionContent, PageVersionDetail, PageVersionSummary } from "@/server/versions";

import { DiffView } from "./diff-view";
import { authorName } from "./labels";

export type HistoryMode = "preview" | "diff";
export type DiffAgainst = "previous" | "current";

type HistoryViewProps = {
  pageHref: string;
  /** `/s/<space>/p/<ref>/history` (the versions' URLs are built on it). */
  historyHref: string;
  pageTitle: string;
  versions: PageVersionSummary[];
  selected: PageVersionDetail | null;
  mode: HistoryMode;
  against: DiffAgainst;
  /** Document the selected version is compared with (null → nothing to compare). */
  compareWith: PageVersionContent | null;
};

export function versionHref(
  historyHref: string,
  versionNo: number,
  mode: HistoryMode,
  against: DiffAgainst,
): string {
  const params = new URLSearchParams({ v: String(versionNo) });
  if (mode === "diff") {
    params.set("mode", "diff");
    params.set("against", against);
  }
  return `${historyHref}?${params}`;
}

/**
 * `/s/<space>/p/<ref>/history`: versions list on the left, read-only preview or block diff of the
 * selected one on the right (stacked on narrow screens). The selection lives in the URL.
 */
export function HistoryView({
  pageHref,
  historyHref,
  pageTitle,
  versions,
  selected,
  mode,
  against,
  compareWith,
}: HistoryViewProps) {
  const t = useTranslations("history");
  const tTree = useTranslations("tree");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 sm:px-8 sm:py-10">
      <header className="flex flex-wrap items-center gap-3">
        <Link
          href={pageHref}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
          aria-label={t("back")}
        >
          <ArrowLeftIcon aria-hidden />
          {t("back")}
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="truncate text-sm text-muted-foreground">{pageTitle || tTree("untitled")}</p>
        </div>
      </header>

      {versions.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <VersionList
            versions={versions}
            selectedNo={selected?.versionNo ?? null}
            historyHref={historyHref}
            mode={mode}
            against={against}
          />
          <section aria-live="polite" className="min-w-0">
            {selected ? (
              <VersionPanel
                selected={selected}
                versions={versions}
                historyHref={historyHref}
                mode={mode}
                against={against}
                compareWith={compareWith}
              />
            ) : (
              <p className="text-muted-foreground">{t("selectPrompt")}</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function VersionList({
  versions,
  selectedNo,
  historyHref,
  mode,
  against,
}: {
  versions: PageVersionSummary[];
  selectedNo: number | null;
  historyHref: string;
  mode: HistoryMode;
  against: DiffAgainst;
}) {
  const t = useTranslations("history");
  const format = useFormatter();
  return (
    <nav aria-label={t("listLabel")}>
      <ol className="flex max-h-[40vh] flex-col gap-1 overflow-y-auto lg:max-h-[75vh]">
        {versions.map((version) => {
          const active = version.versionNo === selectedNo;
          return (
            <li key={version.id}>
              <Link
                href={versionHref(historyHref, version.versionNo, mode, against)}
                scroll={false}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex flex-col gap-0.5 rounded-md border border-transparent px-3 py-2 text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active && "border-border bg-accent",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {version.label || t("versionNo", { no: version.versionNo })}
                  </span>
                  <Badge variant="secondary">{t(`reasons.${version.reason}`)}</Badge>
                </span>
                <time dateTime={version.createdAt} className="text-muted-foreground">
                  {format.dateTime(new Date(version.createdAt), "dateTime")}
                </time>
                <span className="truncate text-muted-foreground">
                  {authorName(version.createdBy) ?? t("authorUnknown")}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function VersionPanel({
  selected,
  versions,
  historyHref,
  mode,
  against,
  compareWith,
}: {
  selected: PageVersionDetail;
  versions: PageVersionSummary[];
  historyHref: string;
  mode: HistoryMode;
  against: DiffAgainst;
  compareWith: PageVersionContent | null;
}) {
  const t = useTranslations("history");
  const format = useFormatter();
  const hasPrevious = versions.some((v) => v.versionNo < selected.versionNo);
  const isEmpty = (selected.contentJson.content ?? []).length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">
            {selected.label || t("versionNo", { no: selected.versionNo })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {format.dateTime(new Date(selected.createdAt), "dateTime")} ·{" "}
            {authorName(selected.createdBy) ?? t("authorUnknown")} ·{" "}
            {t(`reasons.${selected.reason}`)}
            {selected.restoredFromVersionNo !== null &&
              ` · ${t("restoredFrom", { no: selected.restoredFromVersionNo })}`}
          </p>
        </div>
        <div role="group" aria-label={t("modes.label")} className="flex flex-wrap gap-1">
          <ModeLink
            href={versionHref(historyHref, selected.versionNo, "preview", against)}
            active={mode === "preview"}
          >
            {t("modes.preview")}
          </ModeLink>
          <ModeLink
            href={versionHref(historyHref, selected.versionNo, "diff", against)}
            active={mode === "diff"}
          >
            {t("modes.diff")}
          </ModeLink>
        </div>
      </div>

      {mode === "preview" ? (
        isEmpty ? (
          <p className="text-muted-foreground">{t("emptyContent")}</p>
        ) : (
          // Remount per version: the editor takes its content once.
          <BlockEditor
            key={selected.id}
            content={selected.contentJson as JSONContent}
            editable={false}
            title={selected.title}
          />
        )
      ) : (
        <div className="flex flex-col gap-3">
          <div role="group" aria-label={t("compare")} className="flex flex-wrap gap-1">
            {hasPrevious && (
              <ModeLink
                href={versionHref(historyHref, selected.versionNo, "diff", "previous")}
                active={against === "previous"}
              >
                {t("diff.against.previous")}
              </ModeLink>
            )}
            <ModeLink
              href={versionHref(historyHref, selected.versionNo, "diff", "current")}
              active={against === "current"}
            >
              {t("diff.against.current")}
            </ModeLink>
          </div>
          {compareWith === null ? (
            <p className="text-muted-foreground">{t("diff.noPrevious")}</p>
          ) : (
            <DiffView
              // `previous`: what this version changed; `current`: what changed since this version.
              before={against === "previous" ? compareWith : selected.contentJson}
              after={against === "previous" ? selected.contentJson : compareWith}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ModeLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={buttonVariants({ variant: active ? "secondary" : "ghost", size: "sm" })}
    >
      {children}
    </Link>
  );
}
