import { type Editor, Extension, type JSONContent } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode, Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";

import { markdownToBlocks } from "../markdown/from-markdown";

/**
 * Markdown pasted as plain text (VS Code, a terminal, a `.md` file opened in a text editor, an AI
 * chat answer) becomes formatted blocks instead of one code block or a wall of `#` and `**`.
 * The same conversion inserts an imported `.md` file ({@link insertMarkdown}).
 *
 * Rich HTML (a web page, Google Docs, a spreadsheet) keeps the normal paste, and so do copies made
 * inside the editor and pastes into a code block.
 */

export const markdownPastePluginKey = new PluginKey("kbMarkdownPaste");

/** Largest `.md` file the editor imports (the parser runs in the browser). */
export const MARKDOWN_IMPORT_MAX_BYTES = 2 * 1024 * 1024;

/** File extensions and MIME types read as Markdown (file picker `accept`, drop detection). */
export const MARKDOWN_FILE_ACCEPT = ".md,.markdown,.mdown,.mkd,text/markdown,text/x-markdown";

/** True for a `.md` / `.markdown` file (by name, or by MIME type when the name says nothing). */
export function isMarkdownFile(file: Pick<File, "name" | "type">): boolean {
  if (/\.(md|markdown|mdown|mkd)$/i.test(file.name)) return true;
  return file.type === "text/markdown" || file.type === "text/x-markdown";
}

/** Block-level Markdown that alone makes a paste Markdown (ATX heading, fence, table, alert). */
const STRONG_LINE: Record<string, RegExp> = {
  heading: /^#{1,6}[ \t]+\S/,
  fence: /^ {0,3}(```|~~~)/,
  table: /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/,
  alert: /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO)\]/i,
};

/** Lines that hint at Markdown; two hints (or one plus inline syntax) are enough. */
const WEAK_LINE: Record<string, RegExp> = {
  bullet: /^\s*[-*+][ \t]+\S/,
  ordered: /^\s*\d{1,9}[.)][ \t]+\S/,
  quote: /^>[ \t]?\S/,
  rule: /^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/,
};

const INLINE: Record<string, RegExp> = {
  bold: /\*\*[^*\n]+\*\*|__[^_\n]+__/,
  code: /(^|[^`])`[^`\n]+`/,
  link: /\[[^\]\n]+\]\((?:https?:\/\/|\/|#|mailto:)[^)\s]*\)/,
  strike: /~~[^~\n]+~~/,
};

interface MarkdownSignals {
  /** A heading, fence, table or alert was found. */
  strong: boolean;
  /** Matching lines plus inline constructs. */
  hints: number;
  /** Distinct kinds of syntax found (heading, bullet, bold…). */
  kinds: number;
}

function markdownSignals(text: string): MarkdownSignals {
  const kinds = new Set<string>();
  let strong = false;
  let hints = 0;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const strongKind = Object.keys(STRONG_LINE).find((kind) => STRONG_LINE[kind]!.test(line));
    if (strongKind) {
      strong = true;
      kinds.add(strongKind);
      continue;
    }
    const weakKind = Object.keys(WEAK_LINE).find((kind) => WEAK_LINE[kind]!.test(line));
    if (weakKind) {
      hints += 1;
      kinds.add(weakKind);
    }
  }
  for (const [kind, re] of Object.entries(INLINE)) {
    if (re.test(text)) {
      hints += 1;
      kinds.add(kind);
    }
  }
  return { strong, hints, kinds: kinds.size };
}

/**
 * Whether `text` reads as Markdown rather than ordinary prose: one strong block signal (heading,
 * fence, table, alert), or at least two weaker ones (list items, quotes, rules, bold, links…).
 * Prose with one stray `*` or a single bullet line stays plain text.
 */
export function looksLikeMarkdown(text: string): boolean {
  const { strong, hints } = markdownSignals(text);
  return strong || hints >= 2;
}

/** Tags of HTML that already carries formatting (then the HTML paste is better than ours). */
const RICH_HTML = /<(h[1-6]|ul|ol|li|table|blockquote|strong|b|em|i|a|img|hr)[\s>/]/i;
/** Preformatted HTML: Markdown source shown raw, or a code snippet. */
const PRE_HTML = /<(pre|code)[\s>]/i;

export interface ClipboardPayload {
  text: string;
  html: string;
  /** `vscode-editor-data` of a copy from VS Code (JSON with the language `mode`). */
  vscode?: string;
}

/**
 * Whether a paste should be converted from Markdown. Copies from VS Code in a Markdown file always
 * are; other payloads only when they carry no formatted HTML and the text looks like Markdown.
 */
export function shouldPasteAsMarkdown({ text, html, vscode }: ClipboardPayload): boolean {
  if (!text.trim()) return false;
  if (html.includes("data-pm-slice")) return false;
  if (vscode) {
    let mode: unknown;
    try {
      mode = (JSON.parse(vscode) as { mode?: unknown }).mode;
    } catch {
      mode = undefined;
    }
    if (mode === "markdown") return true;
    // Code from another language stays a code block (TipTap's VS Code paste).
    if (typeof mode === "string" && mode !== "plaintext") return false;
  }
  if (html && RICH_HTML.test(html)) return false;
  // Raw Markdown in a <pre> (a "raw" file view) vs. a code snippet (a shell script full of
  // "# comments" looks like headings): the source must mix two kinds of Markdown syntax.
  if (html && PRE_HTML.test(html)) {
    const { kinds } = markdownSignals(text);
    return kinds >= 2;
  }
  return looksLikeMarkdown(text);
}

/** Text blocks the slice may merge into the block at the cursor (start / end of the paste). */
const MERGEABLE = new Set(["paragraph"]);

/**
 * Transaction replacing the selection with the blocks of `markdown`, or `null` when it holds
 * nothing or cannot be placed here. A leading / trailing paragraph merges into the paragraph at
 * the cursor, like pasted text; other blocks are inserted around it.
 */
export function markdownTransaction(state: EditorState, markdown: string): Transaction | null {
  const blocks = markdownToBlocks(markdown);
  if (blocks.length === 0) return null;
  let nodes: ProseMirrorNode[];
  try {
    nodes = blocks.map((block: JSONContent) => state.schema.nodeFromJSON(block));
    nodes.forEach((node) => node.check());
  } catch {
    return null;
  }
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  const openStart = MERGEABLE.has(first.type.name) ? 1 : 0;
  const openEnd = MERGEABLE.has(last.type.name) ? 1 : 0;
  try {
    const tr = state.tr.replaceSelection(new Slice(Fragment.fromArray(nodes), openStart, openEnd));
    return tr.scrollIntoView();
  } catch {
    return null;
  }
}

/** Inserts `markdown` as blocks at the selection (or at `pos`). Returns whether anything changed. */
export function insertMarkdown(
  editor: Editor,
  markdown: string,
  pos: number | null = null,
): boolean {
  if (pos !== null) {
    editor.commands.setTextSelection(Math.min(pos, editor.state.doc.content.size));
  }
  const tr = markdownTransaction(editor.state, markdown);
  if (!tr) return false;
  editor.view.dispatch(tr);
  editor.commands.focus();
  return true;
}

/**
 * The paste handler. Registered with a high priority: TipTap's code block turns every VS Code
 * copy into a code block before other handlers run, which is what Markdown copies must avoid.
 */
export const MarkdownPaste = Extension.create({
  name: "markdownPaste",
  priority: 1000,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: markdownPastePluginKey,
        props: {
          handlePaste: (view, event) => {
            const data = event.clipboardData;
            if (!data || !view.editable) return false;
            // Ctrl/⌘+Shift+V ("paste as plain text"): ProseMirror records Shift on the view.
            if ((view as unknown as { input?: { shiftKey?: boolean } }).input?.shiftKey) {
              return false;
            }
            if ((data.files?.length ?? 0) > 0 && !data.getData("text/plain").trim()) return false;
            if (view.state.selection.$from.parent.type.spec.code) return false;
            const text = data.getData("text/plain");
            const payload = {
              text,
              html: data.getData("text/html"),
              vscode: data.getData("vscode-editor-data"),
            };
            if (!shouldPasteAsMarkdown(payload)) return false;
            const tr = markdownTransaction(view.state, text);
            if (!tr) return false;
            event.preventDefault();
            view.dispatch(tr.setMeta("paste", true).setMeta("uiEvent", "paste"));
            return true;
          },
        },
      }),
    ];
  },
});
