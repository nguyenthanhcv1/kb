// @vitest-environment happy-dom
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from "../extensions";
import {
  insertMarkdown,
  isMarkdownFile,
  looksLikeMarkdown,
  MarkdownPaste,
  markdownPastePluginKey,
  shouldPasteAsMarkdown,
} from "./markdown-paste";

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
  document.body.innerHTML = "";
});

async function createEditor(content: JSONContent | string = "<p></p>") {
  const editor = new Editor({
    element: document.body.appendChild(document.createElement("div")),
    extensions: [...createExtensions(), MarkdownPaste],
    content,
  });
  editors.push(editor);
  await new Promise((resolve) => editor.on("create", resolve));
  return editor;
}

type Clipboard = { text?: string; html?: string; vscode?: string };

/** Runs the paste props the way ProseMirror does: first handler returning true wins. */
function paste(editor: Editor, data: Clipboard): boolean {
  const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  const values: Record<string, string | undefined> = {
    "text/plain": data.text,
    "text/html": data.html,
    "vscode-editor-data": data.vscode,
  };
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => values[type] ?? "", files: [] },
  });
  return editor.view.someProp("handlePaste", (f) => f(editor.view, event, null as never)) ?? false;
}

const types = (editor: Editor) => editor.getJSON().content?.map((node) => node.type);

const DOC = [
  "# Flow tự động tạo phiếu",
  "",
  "> Tài liệu vận hành cho luồng `request → GHN → result`.",
  "",
  "## Mục đích",
  "",
  "Mỗi ngày lúc **10:00**, automation đọc các đơn.",
  "",
  "- **Google Sheet:** `1Snp`",
  "- **Tab nguồn:** `request`",
  "",
  "```text",
  "request",
  "```",
].join("\n");

describe("looksLikeMarkdown", () => {
  it.each([
    ["# Title\n\ntext", true],
    ["| a | b |\n| --- | --- |\n| 1 | 2 |", true],
    ["```js\nx()\n```", true],
    ["- one\n- two", true],
    ["Some **bold** and a [link](https://e.com)", true],
    ["Just a sentence.", false],
    ["2 * 3 = 6 and 4 * 5 = 20", false],
    ["- only one bullet", false],
  ])("%j → %s", (text, expected) => {
    expect(looksLikeMarkdown(text)).toBe(expected);
  });
});

describe("shouldPasteAsMarkdown", () => {
  it("converts a VS Code copy of a Markdown file", () => {
    expect(shouldPasteAsMarkdown({ text: "hello", html: "", vscode: '{"mode":"markdown"}' })).toBe(
      true,
    );
  });

  it("keeps a VS Code copy of code as code", () => {
    expect(
      shouldPasteAsMarkdown({ text: "# comment\nls", html: "", vscode: '{"mode":"shellscript"}' }),
    ).toBe(false);
  });

  it("prefers formatted HTML (web page, Google Docs)", () => {
    expect(shouldPasteAsMarkdown({ text: DOC, html: "<h1>Flow</h1><p>x</p>" })).toBe(false);
  });

  it("ignores copies made inside the editor", () => {
    expect(shouldPasteAsMarkdown({ text: DOC, html: '<p data-pm-slice="1 1 []">x</p>' })).toBe(
      false,
    );
  });

  it("reads raw Markdown in <pre> but not a shell snippet", () => {
    expect(shouldPasteAsMarkdown({ text: DOC, html: `<pre>${DOC}</pre>` })).toBe(true);
    const shell = "# install\npnpm install\n# run\npnpm dev";
    expect(shouldPasteAsMarkdown({ text: shell, html: `<pre>${shell}</pre>` })).toBe(false);
  });
});

describe("MarkdownPaste", () => {
  it("turns pasted Markdown into blocks", async () => {
    const editor = await createEditor();
    expect(paste(editor, { text: DOC })).toBe(true);
    expect(types(editor)).toEqual([
      "heading",
      "blockquote",
      "heading",
      "paragraph",
      "bulletList",
      "codeBlock",
      "paragraph",
    ]);
    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain('"type":"bold"');
    expect(json).not.toContain("**");
  });

  it("wins over the VS Code code block paste for Markdown files", async () => {
    const editor = await createEditor();
    expect(paste(editor, { text: DOC, vscode: '{"mode":"markdown"}' })).toBe(true);
    expect(types(editor)?.[0]).toBe("heading");
  });

  it("still makes a code block from VS Code code", async () => {
    const editor = await createEditor();
    expect(paste(editor, { text: "const a = 1;", vscode: '{"mode":"typescript"}' })).toBe(true);
    expect(types(editor)?.[0]).toBe("codeBlock");
  });

  it("merges inline Markdown into the paragraph at the cursor", async () => {
    const editor = await createEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello " }] }],
    });
    editor.commands.setTextSelection(7);
    expect(paste(editor, { text: "**bold** and `code`" })).toBe(true);
    expect(types(editor)).toEqual(["paragraph"]);
    expect(editor.state.doc.firstChild?.textContent).toBe("Hello bold and code");
  });

  it("leaves Markdown pasted into a code block to the normal (text) paste", async () => {
    const editor = await createEditor("<pre><code>x</code></pre>");
    editor.commands.setTextSelection(2);
    expect(editor.view.state.plugins.some((p) => p.spec.key === markdownPastePluginKey)).toBe(true);
    expect(paste(editor, { text: DOC })).toBe(false);
    expect(types(editor)?.[0]).toBe("codeBlock");
    expect(editor.state.doc.firstChild?.textContent).toBe("x");
  });

  it("keeps Ctrl/⌘+Shift+V a plain-text paste", async () => {
    const editor = await createEditor();
    (editor.view as unknown as { input: { shiftKey: boolean } }).input.shiftKey = true;
    expect(paste(editor, { text: DOC })).toBe(false);
  });

  it("leaves plain prose to the normal paste", async () => {
    const editor = await createEditor();
    expect(paste(editor, { text: "Just a sentence." })).toBe(false);
  });
});

describe("insertMarkdown", () => {
  it("inserts a file's blocks at the cursor", async () => {
    const editor = await createEditor("<p>before</p>");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(insertMarkdown(editor, "## Part\n\n| a | b |\n| - | - |\n| 1 | 2 |")).toBe(true);
    expect(types(editor)).toContain("table");
    expect(types(editor)).toContain("heading");
  });

  it("does nothing for an empty file", async () => {
    const editor = await createEditor();
    expect(insertMarkdown(editor, "  \n")).toBe(false);
  });
});

describe("isMarkdownFile", () => {
  it.each([
    [{ name: "README.md", type: "" }, true],
    [{ name: "notes.markdown", type: "text/plain" }, true],
    [{ name: "blob", type: "text/markdown" }, true],
    [{ name: "a.txt", type: "text/plain" }, false],
    [{ name: "a.png", type: "image/png" }, false],
  ])("%j → %s", (file, expected) => {
    expect(isMarkdownFile(file)).toBe(expected);
  });
});
