"use client";

import {
  EDITOR_SHORTCUTS,
  type EditorShortcut,
  formatShortcutKeys,
  SHORTCUT_GROUPS,
} from "@kb/editor/ui";
import { useTranslations } from "next-intl";
import { useCallback, useSyncExternalStore } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const subscribe = () => () => {};

/** `true` on macOS/iOS (⌘ keys). Always `false` during SSR, corrected after hydration. */
export function useIsMac(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent),
    () => false,
  );
}

/** Display text of a shortcut by id, e.g. `shortcut("moveUp")` → "Ctrl+Shift+↑" or "⌘⇧↑". */
export function useShortcutLabel() {
  const isMac = useIsMac();
  return useCallback(
    (id: EditorShortcut["id"]) => {
      const entry = EDITOR_SHORTCUTS.find((s) => s.id === id);
      if (!entry) return "";
      return formatShortcutKeys(entry.keys, isMac).join(isMac ? "" : "+");
    },
    [isMac],
  );
}

/** Help dialog listing every editor shortcut (opened with Mod-/ or from the page menu). */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("editor.shortcuts");
  const tEditor = useTranslations("editor");
  const isMac = useIsMac();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto sm:max-w-xl"
        closeLabel={tEditor("close")}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group} aria-labelledby={`shortcuts-${group}`}>
              <h3
                id={`shortcuts-${group}`}
                className="mb-2 text-sm font-medium text-muted-foreground"
              >
                {t(`groups.${group}`)}
              </h3>
              <dl className="flex flex-col gap-1.5">
                {EDITOR_SHORTCUTS.filter((s) => s.group === group).map((shortcut) => (
                  <div
                    key={shortcut.id}
                    className="flex items-center justify-between gap-4 text-sm"
                  >
                    <dt>{t(`items.${shortcut.id}`)}</dt>
                    <dd className="flex shrink-0 gap-1">
                      {formatShortcutKeys(shortcut.keys, isMac).map((key, index) => (
                        <kbd
                          key={index}
                          className="min-w-6 rounded border bg-muted px-1.5 py-0.5 text-center font-mono text-xs text-muted-foreground"
                        >
                          {key}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
