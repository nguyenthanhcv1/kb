"use client";

import { useTranslations } from "next-intl";
import { useRef, type KeyboardEvent, type PointerEvent } from "react";

import { cn } from "@/components/ui/utils";

import {
  clampSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_STEP,
} from "./sidebar-width";

type Props = {
  width: number;
  /** Called on every drag frame / key press. */
  onResize(width: number): void;
  /** Called once the width settles (drag end, key press, reset) — persist here. */
  onCommit(width: number): void;
};

/**
 * Vertical splitter on the right edge of the desktop sidebar: drag to resize, ←/→ (Shift = ×4),
 * Home/End for min/max, double-click or Enter to reset to the default width.
 */
export function SidebarResizeHandle({ width, onResize, onCommit }: Props) {
  const t = useTranslations("common.shell");
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null);

  function set(next: number) {
    const value = clampSidebarWidth(next);
    onResize(value);
    onCommit(value);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width, width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const next = clampSidebarWidth(drag.current.startWidth + event.clientX - drag.current.startX);
    drag.current.width = next;
    onResize(next);
  }

  function endDrag() {
    if (!drag.current) return;
    onCommit(drag.current.width);
    drag.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? SIDEBAR_WIDTH_STEP * 4 : SIDEBAR_WIDTH_STEP;
    const actions: Record<string, () => number> = {
      ArrowLeft: () => width - step,
      ArrowRight: () => width + step,
      Home: () => SIDEBAR_WIDTH_MIN,
      End: () => SIDEBAR_WIDTH_MAX,
      Enter: () => SIDEBAR_WIDTH_DEFAULT,
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    set(action());
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("resizeSidebar")}
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_WIDTH_MIN}
      aria-valuemax={SIDEBAR_WIDTH_MAX}
      title={t("resizeSidebarHint")}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => set(SIDEBAR_WIDTH_DEFAULT)}
      onKeyDown={onKeyDown}
      className={cn(
        "group/resize absolute inset-y-0 -right-1.5 z-10 w-3 cursor-col-resize touch-none outline-none",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:bg-transparent after:transition-colors",
        "hover:after:bg-ring/60 focus-visible:after:bg-ring active:after:bg-ring",
      )}
    />
  );
}
