"use client";

import { FileTextIcon, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/components/ui/utils";
import type { SearchHit } from "@/server/search/links";

import { searchErrorCode } from "./errors";
import { pushRecent, readRecent, type RecentPage } from "./recent";

const DEBOUNCE_MS = 150;
const LIMIT = 8;
const SHORTCUT_MAC = "⌘K";
const SHORTCUT_OTHER = "Ctrl K";

type Row =
  { kind: "page"; id: string; page: RecentPage } | { kind: "all"; id: string; href: string };

type Status =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; query: string; hits: SearchHit[] }
  | { state: "error"; code: string };

const subscribeNever = () => () => {};

export function searchHref(query: string): string {
  return `/search?q=${encodeURIComponent(query)}`;
}

/**
 * Quick switcher (T5.3): a button in the top bar and the global Cmd/Ctrl+K shortcut open a
 * dialog with a search box over `/api/search`. Fully keyboard driven (combobox + listbox:
 * arrows move, Enter opens, Esc closes). With an empty box it lists the recently opened results;
 * the last row leads to the full results page.
 */
export function QuickSwitcher({
  triggerClassName,
  variant = "bar",
  globalShortcut = true,
}: {
  triggerClassName?: string;
  /** `bar` is the compact top-bar field; `hero` the large search box of the home page. */
  variant?: "bar" | "hero";
  /**
   * Whether this instance owns the Cmd/Ctrl+K shortcut. Only one mounted instance should
   * (two would toggle their dialogs together), so the home hero passes `false`.
   */
  globalShortcut?: boolean;
}) {
  const t = useTranslations("search");
  const tErrors = useTranslations("errors");
  const tTree = useTranslations("tree");
  const router = useRouter();
  const baseId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [recent, setRecent] = useState<RecentPage[]>([]);
  const [active, setActive] = useState(0);
  const shortcut = useSyncExternalStore(
    subscribeNever,
    () => (/mac|iphone|ipad/i.test(navigator.userAgent) ? SHORTCUT_MAC : SHORTCUT_OTHER),
    () => SHORTCUT_OTHER,
  );
  const openRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleOpenChange = useCallback((next: boolean) => {
    openRef.current = next;
    setOpen(next);
    if (next) {
      setRecent(readRecent());
    } else {
      abortRef.current?.abort();
      setQuery("");
      setStatus({ state: "idle" });
      setActive(0);
    }
  }, []);

  useEffect(() => {
    if (!globalShortcut) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        handleOpenChange(!openRef.current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleOpenChange, globalShortcut]);

  const trimmed = query.trim();
  useEffect(() => {
    abortRef.current?.abort();
    if (!trimmed) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = window.setTimeout(async () => {
      setStatus({ state: "loading" });
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}&limit=${LIMIT}`,
          { signal: controller.signal },
        );
        const body = (await response.json()) as { results?: SearchHit[]; error?: string };
        if (controller.signal.aborted) return;
        if (!response.ok || !body.results) {
          setStatus({ state: "error", code: body.error ?? "SEARCH_FAILED" });
        } else {
          setStatus({ state: "ready", query: trimmed, hits: body.results });
        }
      } catch (error) {
        if (controller.signal.aborted || (error as Error).name === "AbortError") return;
        setStatus({ state: "error", code: "SEARCH_FAILED" });
      }
      setActive(0);
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  const hits = trimmed && status.state === "ready" ? status.hits : [];
  const rows: Row[] = trimmed
    ? [
        ...hits.map((hit): Row => ({
          kind: "page",
          id: hit.pageId,
          page: { href: hit.href, title: hit.title, icon: hit.icon, spaceName: hit.spaceName },
        })),
        { kind: "all", id: "all", href: searchHref(trimmed) },
      ]
    : recent.map((page): Row => ({ kind: "page", id: page.href, page }));
  const activeIndex = Math.min(active, Math.max(rows.length - 1, 0));
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const go = (row: Row) => {
    if (row.kind === "page") pushRecent(row.page);
    handleOpenChange(false);
    router.push(row.kind === "page" ? row.page.href : row.href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + rows.length) % rows.length);
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const row = rows[activeIndex];
      if (row) go(row);
    }
  };

  const loading = !!trimmed && status.state !== "ready" && status.state !== "error";
  const showEmpty = !!trimmed && status.state === "ready" && hits.length === 0;
  const errorCode = status.state === "error" ? status.code : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {variant === "hero" ? (
          <button
            type="button"
            aria-label={t("quickSwitcher.trigger")}
            className={cn(
              "flex h-14 w-full items-center gap-3 rounded-[10px] border border-primary bg-card px-4 text-left text-base text-muted-foreground ring-[3px] ring-primary/20 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              triggerClassName,
            )}
          >
            <SearchIcon className="size-5 shrink-0" aria-hidden />
            <span className="flex-1 truncate">{t("placeholder")}</span>
          </button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-9 gap-2 px-2.5 text-muted-foreground sm:w-56 sm:justify-start",
              triggerClassName,
            )}
            aria-label={t("quickSwitcher.trigger")}
            aria-keyshortcuts="Control+K Meta+K"
          >
            <SearchIcon className="size-4" aria-hidden />
            <span className="hidden flex-1 text-left sm:inline">{t("placeholder")}</span>
            <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[11px] sm:inline">
              {shortcut}
            </kbd>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        closeLabel={t("quickSwitcher.close")}
      >
        <DialogTitle className="sr-only">{t("quickSwitcher.title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("quickSwitcher.description")}</DialogDescription>
        <div className="flex items-center gap-2 border-b px-4">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="text"
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls={`${baseId}-list`}
            aria-activedescendant={rows.length > 0 ? optionId(activeIndex) : undefined}
            aria-autocomplete="list"
            aria-label={t("placeholder")}
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t("placeholder")}
            className="h-12 min-w-0 flex-1 bg-transparent pr-8 text-base outline-none placeholder:text-muted-foreground md:text-sm"
          />
        </div>

        <div role="status" className="sr-only">
          {loading ? t("quickSwitcher.searching") : null}
          {status.state === "ready" && trimmed ? t("results.count", { count: hits.length }) : null}
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {!trimmed && rows.length > 0 && (
            <p className="px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">
              {t("quickSwitcher.recent")}
            </p>
          )}
          {errorCode && (
            <p role="alert" className="px-2 py-3 text-sm text-destructive">
              {tErrors(searchErrorCode(errorCode))}
            </p>
          )}
          {loading && hits.length === 0 && (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              {t("quickSwitcher.searching")}
            </p>
          )}
          {showEmpty && (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              {t("quickSwitcher.empty", { query: trimmed })}
            </p>
          )}
          <ul
            id={`${baseId}-list`}
            role="listbox"
            aria-label={t("quickSwitcher.listLabel")}
            className="flex flex-col gap-0.5"
          >
            {rows.map((row, index) => (
              <li
                key={row.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === activeIndex}
                onMouseMove={() => setActive(index)}
                onClick={() => go(row)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm",
                  index === activeIndex && "bg-accent text-accent-foreground",
                )}
              >
                {row.kind === "page" ? (
                  <>
                    <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
                      {row.page.icon ?? <FileTextIcon className="size-4 text-muted-foreground" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {row.page.title || tTree("untitled")}
                    </span>
                    <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
                      {row.page.spaceName}
                    </span>
                  </>
                ) : (
                  <>
                    <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      {t("quickSwitcher.seeAll", { query: trimmed })}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
