"use client";

import { createExtensions, type CreateExtensionsOptions } from "@kb/editor";
import {
  EditorShortcuts,
  FileUpload,
  filterSlashItems,
  insertAttachment,
  Placeholder,
  runSlashItem,
  SLASH_ITEMS,
  SlashCommand,
  type SlashItem,
  TableDrag,
  TableShortcuts,
} from "@kb/editor/ui";
import type { AnyExtension, Editor, JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/components/ui/utils";
import { createAttachmentUpload } from "@/server/attachments/actions";
import { createClient } from "@/lib/supabase/client";

import {
  AttachmentUploadError,
  measureImage,
  uploadAttachment,
  type UploadDeps,
} from "./attachment-upload";
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
  /** Page the editor belongs to: enables uploading images and files (drag & drop, paste). */
  pageId?: string;
  className?: string;
};

const uploadDeps: UploadDeps = {
  createUpload: createAttachmentUpload,
  putFile: ({ path, token }, file) =>
    createClient().storage.from("attachments").uploadToSignedUrl(path, token, file),
  measureImage,
};

type UploadStatus = { key: number; name: string; state: "uploading" | "failed"; error?: string };

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
  pageId,
  className,
}: BlockEditorProps) {
  const t = useTranslations("editor");
  const tErrors = useTranslations("errors");
  const tTable = useTranslations("table");
  const text = useBlockText();
  const [linkRequested, setLinkRequested] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** Incremented by Alt-F10 in a table: the table toolbar takes keyboard focus. */
  const [tableMenuRequest, setTableMenuRequest] = useState(0);
  /** Slash item waiting for its image URL (dialog open while set). */
  const [pendingImage, setPendingImage] = useState<SlashItem | null>(null);

  // Extensions are created once; they read the latest translations/callbacks from `latest`.
  const [latest] = useState(() => ({
    t,
    title: text.title,
    onChange,
    onFiles: (_files: File[], _pos: number | null) => {},
  }));
  const editorRef = useRef<Editor | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** Incremented by the "File" slash item: opens the file picker. */
  const [filePickerRequest, setFilePickerRequest] = useState(0);
  const nextUpload = useRef(0);
  const [uploads, setUploads] = useState<UploadStatus[]>([]);

  const startUploads = (files: File[], pos: number | null) => {
    if (!pageId) return;
    let at = pos;
    for (const file of files) {
      const key = nextUpload.current++;
      const name = file.name || t("upload.unnamed");
      setUploads((list) => [...list, { key, name, state: "uploading" }]);
      void uploadAttachment(pageId, file, uploadDeps)
        .then((uploaded) => {
          if (editorRef.current) insertAttachment(editorRef.current, uploaded, at);
          // Later files of a multi-file drop follow the first one instead of stacking in place.
          at = null;
          setUploads((list) => list.filter((item) => item.key !== key));
        })
        .catch((error: unknown) => {
          const code =
            error instanceof AttachmentUploadError ? error.code : "ATTACHMENT_UPLOAD_FAILED";
          setUploads((list) =>
            list.map((item) =>
              item.key === key ? { ...item, state: "failed", error: tErrors(code) } : item,
            ),
          );
        });
    }
  };
  useEffect(() => {
    Object.assign(latest, { t, title: text.title, onChange, onFiles: startUploads });
  });

  const editor = useEditor({
    // A read-only view renders on the server too (first paint without JS); an editable one only
    // on the client.
    immediatelyRender: !editable,
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
          if (props.item.input.kind === "file") setFilePickerRequest((count) => count + 1);
          else setPendingImage(props.item);
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
      FileUpload.configure({ onFiles: (files, pos) => latest.onFiles(files, pos) }),
      TableDrag.configure({
        labels: { row: tTable("drag.row"), column: tTable("drag.column") },
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
    if (filePickerRequest > 0) fileInput.current?.click();
  }, [filePickerRequest]);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

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
      {pageId && editable && (
        <>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            tabIndex={-1}
            aria-label={t("upload.pick")}
            onChange={(event) => {
              startUploads(Array.from(event.target.files ?? []), null);
              event.target.value = "";
            }}
          />
          <div role="status" aria-live="polite" className="mt-2 flex flex-col gap-1 md:pl-8">
            {uploads.map((item) => (
              <p
                key={item.key}
                className={cn(
                  "flex items-center gap-2 text-sm",
                  item.state === "failed" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                <span className="truncate">
                  {item.state === "failed"
                    ? t("upload.failed", { name: item.name, error: item.error ?? "" })
                    : t("upload.uploading", { name: item.name })}
                </span>
                {item.state === "failed" && (
                  <button
                    type="button"
                    className="shrink-0 rounded-sm underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
                    onClick={() => setUploads((list) => list.filter((u) => u.key !== item.key))}
                  >
                    {t("upload.dismiss")}
                  </button>
                )}
              </p>
            ))}
          </div>
        </>
      )}
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <ImageDialog
        open={pendingImage !== null}
        onOpenChange={(open) => {
          if (!open) setPendingImage(null);
        }}
        onUpload={
          pageId
            ? (files) => {
                setPendingImage(null);
                startUploads(files, null);
              }
            : undefined
        }
        onInsert={(src) => {
          if (editor && pendingImage) pendingImage.run(editor.chain().focus(), { src }).run();
          setPendingImage(null);
        }}
      />
    </div>
  );
}
