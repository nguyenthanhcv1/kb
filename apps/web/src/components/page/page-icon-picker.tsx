"use client";

import { SmilePlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/components/ui/utils";
import { PAGE_ICON_MAX_LENGTH, type PageSummary } from "@/server/pages";
import { setPageIconAction } from "@/server/pages/actions";

import { pageErrorKey } from "./errors";

/** Quick picks (content, not UI text: emojis are the same in every language). */
export const PAGE_ICON_SUGGESTIONS = [
  "📄",
  "📘",
  "📙",
  "📗",
  "📝",
  "📌",
  "📎",
  "📊",
  "📈",
  "🗂️",
  "📁",
  "🗓️",
  "✅",
  "⭐",
  "💡",
  "🚀",
  "🎯",
  "🔧",
  "⚙️",
  "🔒",
  "🧭",
  "🏠",
  "👋",
  "🎨",
] as const;

type PageIconPickerProps = {
  page: Pick<PageSummary, "id" | "icon">;
  editable: boolean;
  onChanged?: (page: PageSummary) => void;
};

/**
 * Page icon above the title. Editors open a popover with suggestions, a free emoji field and
 * "remove"; saving goes through `setPageIconAction` (title untouched). Viewers see the icon only.
 */
export function PageIconPicker({ page, editable, onChanged }: PageIconPickerProps) {
  const t = useTranslations();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [icon, setIcon] = useState(page.icon);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [seen, setSeen] = useState(page.icon);
  // Follow a fresh server render (icon changed elsewhere).
  if (page.icon !== seen) {
    setSeen(page.icon);
    setIcon(page.icon);
  }

  if (!editable) {
    return icon ? (
      <span aria-hidden className="text-5xl leading-none select-none">
        {icon}
      </span>
    ) : null;
  }

  function apply(next: string | null) {
    setError(null);
    startTransition(async () => {
      const result = await setPageIconAction({ pageId: page.id, icon: next });
      if (!result.ok) {
        setError(t(pageErrorKey(result.code)));
        return;
      }
      setIcon(result.data.icon);
      setCustom("");
      setOpen(false);
      onChanged?.(result.data);
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <PopoverTrigger asChild>
        {icon ? (
          <Button
            variant="ghost"
            aria-label={t("tree.page.icon.change")}
            className="size-16 self-start p-0 text-5xl leading-none"
          >
            <span aria-hidden>{icon}</span>
          </Button>
        ) : (
          <Button variant="ghost" size="sm" className="self-start text-muted-foreground">
            <SmilePlusIcon aria-hidden />
            {t("tree.page.icon.add")}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-80 gap-3">
        <p className="text-sm font-medium">{t("tree.page.icon.pickerTitle")}</p>
        <div
          role="group"
          aria-label={t("tree.page.icon.suggestions")}
          className="grid grid-cols-8 gap-1"
        >
          {PAGE_ICON_SUGGESTIONS.map((emoji) => (
            <Button
              key={emoji}
              type="button"
              variant="ghost"
              size="icon"
              disabled={pending}
              aria-pressed={emoji === icon}
              onClick={() => apply(emoji)}
              className={cn("text-xl", emoji === icon && "bg-accent")}
            >
              {emoji}
            </Button>
          ))}
        </div>
        <form
          className="grid gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (custom.trim()) apply(custom);
          }}
        >
          <label htmlFor={inputId} className="text-sm text-muted-foreground">
            {t("tree.page.icon.custom")}
          </label>
          <div className="flex gap-2">
            <Input
              id={inputId}
              value={custom}
              maxLength={PAGE_ICON_MAX_LENGTH}
              onChange={(event) => setCustom(event.target.value)}
              className="flex-1"
            />
            <Button type="submit" variant="secondary" disabled={pending || !custom.trim()}>
              {t("tree.page.icon.apply")}
            </Button>
          </div>
        </form>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {icon && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => apply(null)}
            className="justify-self-start text-muted-foreground"
          >
            {t("tree.page.icon.remove")}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
