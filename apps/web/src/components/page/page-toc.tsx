"use client";

import { useTranslations } from "next-intl";
import { type RefObject, useEffect, useState } from "react";

import { cn } from "@/components/ui/utils";

export type TocHeading = { level: 1 | 2 | 3; text: string; element: HTMLElement };

/** Headings of the page body in document order; empty ones are skipped. */
export function collectHeadings(root: ParentNode): TocHeading[] {
  const headings: TocHeading[] = [];
  root.querySelectorAll<HTMLElement>(".kb-editor-content :is(h1, h2, h3)").forEach((element) => {
    const text = element.textContent?.trim();
    if (!text) return;
    headings.push({ level: Number(element.tagName.slice(1)) as 1 | 2 | 3, text, element });
  });
  return headings;
}

/** Index of the heading being read: the last one whose top has passed `offset` px from the viewport top. */
export function activeHeadingIndex(tops: readonly number[], offset: number): number {
  let active = 0;
  tops.forEach((top, index) => {
    if (top <= offset) active = index;
  });
  return active;
}

const SCROLL_OFFSET = 120;

/**
 * "On this page": the headings of the body (read from the rendered document, so it follows live
 * edits), click to scroll, the one being read highlighted. Shown from `xl` up; nothing without headings.
 */
export function PageToc({ rootRef }: { rootRef: RefObject<HTMLElement | null> }) {
  const t = useTranslations("tree.page.toc");
  const [headings, setHeadings] = useState<TocHeading[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = collectHeadings(root);
        setHeadings(next);
        setActive(
          activeHeadingIndex(
            next.map((heading) => heading.element.getBoundingClientRect().top),
            SCROLL_OFFSET,
          ),
        );
      });
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    window.addEventListener("scroll", refresh, { passive: true });
    window.addEventListener("resize", refresh);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
    };
  }, [rootRef]);

  if (headings.length === 0) return null;

  return (
    <aside aria-label={t("label")} className="hidden w-56 shrink-0 xl:block">
      <nav className="sticky top-24 flex flex-col gap-0.5 text-sm">
        <p className="mb-2 text-[11px] leading-4 font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {t("title")}
        </p>
        {headings.map((heading, index) => (
          <button
            key={index}
            type="button"
            aria-current={index === active ? "location" : undefined}
            onClick={() => {
              const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
              heading.element.scrollIntoView({
                behavior: reduce ? "auto" : "smooth",
                block: "start",
              });
            }}
            className={cn(
              "border-l-2 border-border py-1.5 pr-2 pl-3 text-left text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
              heading.level === 3 && "pl-6",
              index === active && "border-primary font-semibold text-primary hover:text-primary",
            )}
          >
            {heading.text}
          </button>
        ))}
      </nav>
    </aside>
  );
}
