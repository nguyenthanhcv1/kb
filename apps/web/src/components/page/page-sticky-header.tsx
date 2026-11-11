"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, type RefObject, useEffect, useState } from "react";

import { cn } from "@/components/ui/utils";

/** Height of the app top bar (`h-16`): the page header counts as gone once it slides under it. */
const TOP_BAR_PX = 64;

/**
 * `true` once `target` has scrolled up under the app top bar. Without IntersectionObserver
 * (old browsers, tests) it stays `false`.
 */
export function useScrolledPast(target: RefObject<HTMLElement | null>, enabled = true): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const element = target.current;
    if (!enabled || !element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        // Out of view *above* the viewport only (not when the page is short and it is below).
        setPast(!entry.isIntersecting && entry.boundingClientRect.top < TOP_BAR_PX);
      },
      { rootMargin: `-${TOP_BAR_PX}px 0px 0px 0px` },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [target, enabled]);
  // A disabled observer may have left `true` behind: ignore it rather than reset it in the effect.
  return enabled && past;
}

/**
 * Compact bar that sticks under the top bar while reading, once the page header (title, "Edit",
 * "Share"…) has scrolled away: icon + title (click → back to the top) and the given actions,
 * so a long page can be switched to editing without scrolling back up. Hidden (`invisible`,
 * out of the tab order and the accessibility tree) while the header is on screen.
 */
export function PageStickyHeader({
  visible,
  icon,
  title,
  actions,
}: {
  visible: boolean;
  icon: string | null;
  title: string;
  actions?: ReactNode;
}) {
  const t = useTranslations("tree.page.sticky");
  return (
    // Zero-height sticky anchor: the bar overlays the content instead of pushing it down.
    <div className="sticky top-16 z-30 h-0">
      <div
        data-testid="page-sticky-header"
        data-visible={visible}
        aria-hidden={!visible}
        className={cn(
          "-mx-4 flex h-12 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur transition-opacity duration-150 supports-[backdrop-filter]:bg-background/80 sm:-mx-8 sm:px-8 md:pl-16",
          visible ? "visible opacity-100" : "invisible opacity-0",
        )}
      >
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          title={t("backToTop")}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {icon && (
            <span aria-hidden className="shrink-0 text-base leading-none">
              {icon}
            </span>
          )}
          <span className="truncate">{title}</span>
        </button>
        {/* Mounted only while shown: never a second "Edit" button next to the header's. */}
        {visible && actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
    </div>
  );
}
