import { type Editor, Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * Where an attachment is served (T3.6b): the document stores this stable same-origin path, never
 * a signed URL (it expires) and never the bytes (no base64). `GET /api/attachments/<id>` checks
 * the viewer's access and redirects to a short-lived signed URL.
 */
export function attachmentHref(attachmentId: string, options: { download?: boolean } = {}): string {
  return `/api/attachments/${attachmentId}${options.download ? "?download=1" : ""}`;
}

const ATTACHMENT_PATH = /^\/api\/attachments\/([0-9a-f-]{36})(?:\?download=1)?$/i;

/** Attachment id from an {@link attachmentHref} path, or `null` for any other URL. */
export function parseAttachmentHref(href: string): string | null {
  return ATTACHMENT_PATH.exec(href)?.[1]?.toLowerCase() ?? null;
}

export interface FileUploadOptions {
  /**
   * Called with the files a user pasted or dropped. `pos` is the drop position (document
   * position under the pointer) or `null` for a paste (insert at the selection). The handler
   * uploads them and inserts the result with {@link insertAttachment}.
   */
  onFiles: (files: File[], pos: number | null) => void;
}

export const fileUploadPluginKey = new PluginKey("kbFileUpload");

/** Files in a clipboard/drag payload (a copied image from a browser also carries HTML — files win). */
function filesOf(data: DataTransfer | null): File[] {
  return data ? Array.from(data.files ?? []).filter((file) => file.size > 0 || file.type) : [];
}

/** Drops `<img src="data:…">` from pasted HTML: base64 never enters the document. */
export function stripBase64Images(html: string): string {
  return html.replace(/<img\b[^>]*\bsrc\s*=\s*(["']?)\s*data:[^>]*>/gi, "");
}

/**
 * Pasting or dropping files into the editor hands them to `onFiles` instead of letting the
 * browser/ProseMirror embed them. Pasted HTML images with `data:` sources are removed.
 */
export const FileUpload = Extension.create<FileUploadOptions>({
  name: "fileUpload",

  addOptions() {
    return { onFiles: () => undefined };
  },

  addProseMirrorPlugins() {
    const { onFiles } = this.options;
    const editor = this.editor;
    return [
      new Plugin({
        key: fileUploadPluginKey,
        props: {
          handlePaste: (_view, event) => {
            if (!editor.isEditable) return false;
            const files = filesOf(event.clipboardData);
            if (files.length === 0) return false;
            // Spreadsheets put a picture of the cells next to the cells themselves: text or a
            // table wins, so pasting a range reaches the table paste handler instead of uploading.
            const data = event.clipboardData;
            if (
              data?.getData("text/plain").trim() ||
              /<table[\s>]/i.test(data?.getData("text/html") ?? "")
            )
              return false;
            event.preventDefault();
            onFiles(files, null);
            return true;
          },
          handleDrop: (view: EditorView, event) => {
            if (!editor.isEditable) return false;
            const files = filesOf((event as DragEvent).dataTransfer);
            if (files.length === 0) return false;
            event.preventDefault();
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            onFiles(files, at?.pos ?? null);
            return true;
          },
          transformPastedHTML: stripBase64Images,
        },
      }),
    ];
  },
});

export type UploadedAttachment = {
  id: string;
  fileName: string;
  isImage: boolean;
};

/**
 * Inserts an uploaded attachment: an image block (alt = file name) or a paragraph holding a
 * download link with the file name. `pos` is where it was dropped (`null` → at the selection).
 */
export function insertAttachment(
  editor: Editor,
  attachment: UploadedAttachment,
  pos: number | null,
): void {
  const chain = editor.chain().focus();
  if (pos !== null) chain.setTextSelection(Math.min(pos, editor.state.doc.content.size));
  if (attachment.isImage) {
    chain
      .insertContent({
        type: "image",
        attrs: { src: attachmentHref(attachment.id), alt: attachment.fileName },
      })
      .run();
    return;
  }
  chain
    .insertContent({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: attachment.fileName,
          marks: [
            { type: "link", attrs: { href: attachmentHref(attachment.id, { download: true }) } },
          ],
        },
      ],
    })
    .run();
}
