"use client";

import { normalizeLinkHref } from "@kb/editor/ui";
import { NodeSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { type Editor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  BoldIcon,
  CheckIcon,
  ChevronDownIcon,
  CodeIcon,
  ExternalLinkIcon,
  ItalicIcon,
  LinkIcon,
  type LucideIcon,
  StrikethroughIcon,
  UnderlineIcon,
  UnlinkIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ComponentProps, type FormEvent, useEffect, useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/components/ui/utils";

import {
  activeBlockItem,
  BLOCK_ICONS,
  TURN_INTO_ITEMS,
  turnInto,
  useBlockText,
} from "./block-types";

type Mark = "bold" | "italic" | "underline" | "strike" | "code";

const MARKS: { mark: Mark; icon: LucideIcon; toggle: (editor: Editor) => void }[] = [
  { mark: "bold", icon: BoldIcon, toggle: (e) => e.chain().focus().toggleBold().run() },
  { mark: "italic", icon: ItalicIcon, toggle: (e) => e.chain().focus().toggleItalic().run() },
  {
    mark: "underline",
    icon: UnderlineIcon,
    toggle: (e) => e.chain().focus().toggleUnderline().run(),
  },
  {
    mark: "strike",
    icon: StrikethroughIcon,
    toggle: (e) => e.chain().focus().toggleStrike().run(),
  },
  { mark: "code", icon: CodeIcon, toggle: (e) => e.chain().focus().toggleCode().run() },
];

type Panel = "none" | "blocks" | "link";

type ShouldShow = NonNullable<ComponentProps<typeof BubbleMenu>["shouldShow"]>;

/**
 * Non-empty text selection in an editable, non-code block. Selected table cells get the table
 * toolbar instead.
 */
const shouldShow: ShouldShow = ({ editor, state, from, to }) =>
  editor.isEditable &&
  from !== to &&
  !(state.selection instanceof NodeSelection) &&
  !(state.selection instanceof CellSelection) &&
  !editor.isActive("codeBlock");

export type FormattingBubbleMenuProps = {
  editor: Editor;
  /** Link form requested from outside (Mod-K). */
  linkRequested: boolean;
  onLinkRequestHandled: () => void;
};

/**
 * Floating toolbar over a text selection: marks, link, "turn into". Buttons keep the editor
 * selection (mousedown is prevented); every action also has a keyboard shortcut.
 */
export function FormattingBubbleMenu({
  editor,
  linkRequested,
  onLinkRequestHandled,
}: FormattingBubbleMenuProps) {
  const t = useTranslations("editor");
  const text = useBlockText();
  const [panel, setPanel] = useState<Panel>("none");
  const [prevRequested, setPrevRequested] = useState(false);

  if (linkRequested !== prevRequested) {
    setPrevRequested(linkRequested);
    if (linkRequested) {
      setPanel("link");
      onLinkRequestHandled();
    }
  }

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      marks: Object.fromEntries(MARKS.map(({ mark }) => [mark, e.isActive(mark)])) as Record<
        Mark,
        boolean
      >,
      link: e.getAttributes("link").href as string | undefined,
      block: activeBlockItem(e),
    }),
  });
  // Escape (focus stays in the editor) closes the "turn into" list.
  useEffect(() => {
    if (panel !== "blocks") return;
    const dom = editor.view.dom;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanel("none");
    };
    dom.addEventListener("keydown", onKeyDown);
    return () => dom.removeEventListener("keydown", onKeyDown);
  }, [editor, panel]);

  // Stable references: the menu re-sends its options to the plugin whenever these change.
  const options = useMemo(
    () => ({
      placement: "top" as const,
      offset: 8,
      flip: true,
      shift: { padding: 8 },
      onHide: () => setPanel("none"),
    }),
    [],
  );
  const BlockIcon = state.block ? BLOCK_ICONS[state.block.id] : undefined;

  return (
    <BubbleMenu
      editor={editor}
      options={options}
      shouldShow={shouldShow}
      className="z-40 rounded-lg border bg-popover text-popover-foreground shadow-md"
    >
      {panel === "link" ? (
        <LinkForm
          editor={editor}
          href={state.link}
          onDone={() => {
            setPanel("none");
            editor.commands.focus();
          }}
        />
      ) : (
        <div className="flex flex-col">
          <div
            role="toolbar"
            aria-label={t("bubble.label")}
            className="flex items-center gap-0.5 p-1"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 px-2"
              aria-label={t("bubble.blockType")}
              aria-expanded={panel === "blocks"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setPanel(panel === "blocks" ? "none" : "blocks")}
            >
              {BlockIcon && <BlockIcon className="size-4" aria-hidden />}
              <span className="hidden max-w-28 truncate sm:inline">
                {state.block ? text.title(state.block) : null}
              </span>
              <ChevronDownIcon className="size-3.5 opacity-60" aria-hidden />
            </Button>
            <Separator orientation="vertical" className="mx-0.5 h-6" />
            {MARKS.map(({ mark, icon: Icon, toggle }) => (
              <Button
                key={mark}
                type="button"
                variant="ghost"
                size="icon"
                className={cn("size-8", state.marks[mark] && "bg-accent text-accent-foreground")}
                aria-label={t(`bubble.${mark}`)}
                aria-pressed={state.marks[mark]}
                title={t(`bubble.${mark}`)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggle(editor)}
              >
                <Icon className="size-4" aria-hidden />
              </Button>
            ))}
            <Separator orientation="vertical" className="mx-0.5 h-6" />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn("size-8", state.link && "bg-accent text-accent-foreground")}
              aria-label={t("bubble.link")}
              aria-pressed={Boolean(state.link)}
              title={t("bubble.link")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setPanel("link")}
            >
              <LinkIcon className="size-4" aria-hidden />
            </Button>
          </div>
          {panel === "blocks" && (
            <div
              role="menu"
              aria-label={t("bubble.blockType")}
              className="max-h-64 overflow-y-auto border-t p-1"
            >
              {TURN_INTO_ITEMS.map((item) => {
                const Icon = BLOCK_ICONS[item.id];
                const active = state.block?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      turnInto(editor, item);
                      setPanel("none");
                    }}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
                    <span className="flex-1">{text.title(item)}</span>
                    {active && <CheckIcon className="size-4" aria-hidden />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </BubbleMenu>
  );
}

function LinkForm({
  editor,
  href,
  onDone,
}: {
  editor: Editor;
  href: string | undefined;
  onDone: () => void;
}) {
  const t = useTranslations("editor.link");
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState(href ?? "");
  const [invalid, setInvalid] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      onDone();
      return;
    }
    const normalized = normalizeLinkHref(value);
    if (!normalized) {
      setInvalid(true);
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: normalized }).run();
    onDone();
  };

  return (
    <form onSubmit={submit} className="flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-1 p-2">
      <div className="flex items-center gap-1">
        <label htmlFor={inputId} className="sr-only">
          {t("label")}
        </label>
        <Input
          id={inputId}
          autoFocus
          value={value}
          placeholder={t("placeholder")}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          className="h-8"
          onChange={(event) => {
            setValue(event.target.value);
            setInvalid(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onDone();
            }
          }}
        />
        <Button
          type="submit"
          size="icon"
          className="size-8 shrink-0"
          aria-label={t("apply")}
          title={t("apply")}
        >
          <CheckIcon className="size-4" aria-hidden />
        </Button>
        {href && (
          <>
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={t("open")}
              title={t("open")}
            >
              <a href={href} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon className="size-4" aria-hidden />
              </a>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={t("remove")}
              title={t("remove")}
              onClick={() => {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                onDone();
              }}
            >
              <UnlinkIcon className="size-4" aria-hidden />
            </Button>
          </>
        )}
      </div>
      {invalid && (
        <p id={errorId} role="alert" className="px-1 text-xs text-destructive">
          {t("invalid")}
        </p>
      )}
    </form>
  );
}
