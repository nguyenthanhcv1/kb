"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { cn } from "@/components/ui/utils";

import {
  diffDocuments,
  diffWords,
  summarizeDiff,
  type DiffBlock,
  type DiffRow,
  type DocLike,
} from "./diff";
import { blockTypeKey } from "./labels";

const STATUS_STYLES = {
  added: "border-l-emerald-600 bg-emerald-500/10",
  removed: "border-l-destructive bg-destructive/10",
  changed: "border-l-amber-600 bg-amber-500/10",
} as const;

/** Block-by-block comparison; unchanged blocks are shown dimmed. */
export function DiffView({ before, after }: { before: DocLike; after: DocLike }) {
  const t = useTranslations("history");
  const rows = useMemo(() => diffDocuments(before, after), [before, after]);
  const summary = useMemo(() => summarizeDiff(rows), [rows]);
  const identical = summary.added + summary.removed + summary.changed === 0;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t("diff.summary", summary)}</p>
      {identical && <p>{t("diff.identical")}</p>}
      <ol className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <li key={index}>
            <DiffRowView row={row} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function DiffRowView({ row }: { row: DiffRow }) {
  const t = useTranslations("history");
  const block: DiffBlock = row.status === "removed" ? row.before : row.after;
  const status = row.status;

  return (
    <div
      className={cn(
        "rounded-md border-l-4 border-l-transparent px-3 py-2",
        status !== "same" && STATUS_STYLES[status],
        status === "same" && "text-muted-foreground",
      )}
    >
      {status !== "same" && (
        <p className="mb-1 text-xs font-medium uppercase tracking-wide">
          {t(`diff.${status}`)} · {t(blockTypeKey(block.type))}
        </p>
      )}
      <p className="whitespace-pre-wrap break-words">
        {status === "changed" ? (
          <ChangedText before={row.before.text} after={row.after.text} />
        ) : status === "removed" ? (
          <del>{block.text}</del>
        ) : (
          block.text || <span aria-hidden>&nbsp;</span>
        )}
      </p>
    </div>
  );
}

function ChangedText({ before, after }: { before: string; after: string }) {
  const segments = useMemo(() => diffWords(before, after), [before, after]);
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === "added" ? (
          <ins key={index} className="bg-emerald-500/25 no-underline">
            {segment.text}
          </ins>
        ) : segment.kind === "removed" ? (
          <del key={index} className="bg-destructive/20">
            {segment.text}
          </del>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
