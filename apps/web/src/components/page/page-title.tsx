"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";

import { cn } from "@/components/ui/utils";
import { PAGE_TITLE_MAX_LENGTH, type PageSummary } from "@/server/pages";
import { renamePageAction } from "@/server/pages/actions";

import { pageErrorKey } from "./errors";

/** What `renamePage` stores: NFC, inner whitespace collapsed, trimmed. */
export function normalizeTitle(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

type PageTitleProps = {
  page: Pick<PageSummary, "id" | "title">;
  editable: boolean;
  /** Called with the renamed page (new slug) after a successful save. */
  onRenamed?: (page: PageSummary) => void;
};

/**
 * The page `<h1>`. Editors type in place: Enter or leaving the field saves (through
 * `renamePageAction`), Escape restores the saved title. Empty titles show `tree.untitled`.
 */
export function PageTitle({ page, editable, onRenamed }: PageTitleProps) {
  const t = useTranslations();
  const [value, setValue] = useState(page.title);
  const [saved, setSaved] = useState(page.title);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);
  /** Set by Escape: the blur that follows must not save. */
  const cancelled = useRef(false);

  // A rename elsewhere (another tab, the sidebar) arrives with a fresh server render.
  const [seen, setSeen] = useState(page.title);
  if (page.title !== seen) {
    setSeen(page.title);
    setSaved(page.title);
    setValue(page.title);
  }

  // Grow with the text: the title wraps instead of scrolling.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  if (!editable) {
    return (
      <h1
        className={cn(
          "text-[32px] leading-10 font-bold tracking-[-0.02em] break-words",
          !page.title && "text-muted-foreground",
        )}
      >
        {page.title || t("tree.untitled")}
      </h1>
    );
  }

  function save() {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const title = normalizeTitle(value);
    if (title === saved) {
      setValue(saved);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await renamePageAction({ pageId: page.id, title });
      if (!result.ok) {
        setError(t(pageErrorKey(result.code)));
        return;
      }
      setSaved(result.data.title);
      setValue(result.data.title);
      onRenamed?.(result.data);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-[32px] leading-10 font-bold tracking-[-0.02em]">
        <textarea
          ref={ref}
          value={value}
          rows={1}
          maxLength={PAGE_TITLE_MAX_LENGTH}
          aria-label={t("tree.page.title.label")}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "page-title-error" : undefined}
          placeholder={t("tree.untitled")}
          onChange={(event) => setValue(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              cancelled.current = true;
              setValue(saved);
              setError(null);
              event.currentTarget.blur();
            }
          }}
          className="block w-full resize-none overflow-hidden rounded-md bg-transparent px-1 -mx-1 break-words outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </h1>
      <p aria-live="polite" className="min-h-5 text-sm">
        {error ? (
          <span id="page-title-error" role="alert" className="text-destructive">
            {error}
          </span>
        ) : (
          pending && <span className="text-muted-foreground">{t("tree.page.title.saving")}</span>
        )}
      </p>
    </div>
  );
}
