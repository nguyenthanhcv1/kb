"use client";

import { createExtensions, type CreateExtensionsOptions } from "@kb/editor";
import {
  EditorShortcuts,
  filterSlashItems,
  Placeholder,
  runSlashItem,
  SLASH_ITEMS,
  SlashCommand,
  type SlashItem,
  TableShortcuts,
} from "@kb/editor/ui";
import type { AnyExtension, JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { cn } from "@/components/ui/utils";

import { BlockHandle } from "./block-handle";
import { useBlockText } from "./block-types";
import { FormattingBubbleMenu } from "./bubble-menu";
import { ImageDialog } from "./image-dialog";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { renderSlashMenu } from "./slash-menu";
import { TableMenu } from "./table-menu";

import "./editor.css";

export type BlockEditorProps = {
  /** Initial content (ProseMirror JSON or HTML). Ignored once a Yjs document is bound (T3.5). */
  content?: JSONContent | string;
  editable?: boolean;
  /** Called with the document JSON after every change. */
  onChange?: (content: JSONContent) => void;
  /** Extra extensions, e.g. Collaboration from `lib/collab` (T3.5). */
  extensions?: AnyExtension[];
  /** Forwarded to `createExtensions` (turn `undoRedo` off when bound to Yjs). */
  extensionOptions?: CreateExtensionsOptions;
  /** Page title, e.g. for the file name of a table exported as CSV. */
  title?: string;
  className?: string;
};

/**
 * Block editor: shared schema from `@kb/editor` + slash menu, formatting bubble menu, drag
 * handle with block menu, table toolbar, keyboard shortcuts (Mod-/ lists them) and placeholders —
 * every visible string through next-intl (`editor` and `table` namespaces).
 */
export function BlockEditor({
  content,
  editable = true,
  onChange,
  extensions = [],
  extensionOptions,
  title,
  className,
}: BlockEditorProps) {
  const t = useTranslations("editor");
  const text = useBlockText();
  const [linkRequested, setLinkRequested] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** Incremented by Alt-F10 in a table: the table toolbar takes keyboard focus. */
  const [tableMenuRequest, setTableMenuRequest] = useState(0);
  /** Slash item waiting for its image URL (dialog open while set). */
  const [pendingImage, setPendingImage] = useState<SlashItem | null>(null);

  // Extensions are created once; they read the latest translations/callbacks from `latest`.
  const [latest] = useState(() => ({ t, title: text.title, onChange }));
  useEffect(() => {
    Object.assign(latest, { t, title: text.title, onChange });
  });

  const editor = useEditor({
    // Render on the client only; SSR read-only rendering comes with T3.5.
    immediatelyRender: false,
    editable,
    content,
    extensions: [
      ...createExtensions(extensionOptions),
      Placeholder.configure({
        includeChildren: false,
        placeholder: ({ node }) =>
          node.type.name === "heading"
            ? latest.t("placeholder.heading", { level: node.attrs.level as number })
            : node.type.name === "paragraph"
              ? latest.t("placeholder.paragraph")
              : "",
      }),
      SlashCommand.configure({
        items: (query) => filterSlashItems(SLASH_ITEMS, query, (item) => latest.title(item)),
        render: renderSlashMenu,
        onSelect: (props) => {
          if (!props.item.input) {
            runSlashItem(props);
            return;
          }
          props.editor.chain().focus().deleteRange(props.range).run();
          setPendingImage(props.item);
        },
      }),
      EditorShortcuts.configure({
        onLinkShortcut: (e) => {
          if (e.state.selection.empty) {
            if (!e.isActive("link")) return false;
            e.commands.extendMarkRange("link");
          }
          setLinkRequested(true);
          return true;
        },
        onHelpShortcut: () => {
          setShortcutsOpen(true);
          return true;
        },
      }),
      TableShortcuts.configure({
        onMenuShortcut: () => {
          setTableMenuRequest((count) => count + 1);
          return true;
        },
      }),
      ...extensions,
    ],
    editorProps: {
      attributes: {
        class: "kb-editor-content",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": t("content.label"),
      },
    },
    onUpdate: ({ editor: e }) => latest.onChange?.(e.getJSON()),
  });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  // Keep the accessible name in the current language after a locale switch.
  useEffect(() => {
    editor?.view.dom.setAttribute("aria-label", t("content.label"));
  }, [editor, t]);

  return (
    <div className={cn("kb-editor relative", className)}>
      <EditorContent editor={editor} />
      {editor && editable && (
        <>
          <FormattingBubbleMenu
            editor={editor}
            linkRequested={linkRequested}
            onLinkRequestHandled={() => setLinkRequested(false)}
          />
          <BlockHandle editor={editor} />
          <TableMenu editor={editor} pageTitle={title} focusRequest={tableMenuRequest} />
        </>
      )}
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <ImageDialog
        open={pendingImage !== null}
        onOpenChange={(open) => {
          if (!open) setPendingImage(null);
        }}
        onInsert={(src) => {
          if (editor && pendingImage) pendingImage.run(editor.chain().focus(), { src }).run();
          setPendingImage(null);
        }}
      />
    </div>
  );
}
