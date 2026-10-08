// @vitest-environment happy-dom
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createExtensions } from "../extensions";
import { docToMarkdown, markdownToDoc } from "../markdown";
import {
  findMermaidBlocks,
  MERMAID_PREVIEW_CLASS,
  MERMAID_SOURCE_CLASS,
  MERMAID_TEMPLATE,
  MermaidPreview,
  runSlashItem,
  SLASH_ITEMS,
} from "./index";

const editors: Editor[] = [];

async function createEditor(content: JSONContent | string, render = vi.fn(), editable = true) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    editable,
    extensions: [...createExtensions(), MermaidPreview.configure({ render, debounce: 50 })],
    content,
  });
  editors.push(editor);
  await new Promise((resolve) => editor.on("create", resolve));
  return editor;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const mermaid = (code: string, id = "m1"): JSONContent => ({
  type: "codeBlock",
  attrs: { id, language: "mermaid" },
  content: [{ type: "text", text: code }],
});

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = "";
});

describe("mermaid preview", () => {
  it("finds only code blocks in the mermaid language, nested ones included", () => {
    const doc = {
      type: "doc",
      content: [
        mermaid("graph TD; A-->B", "a"),
        {
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [{ type: "text", text: "x" }],
        },
        { type: "blockquote", content: [mermaid("graph LR; C-->D", "b")] },
      ],
    };
    const editor = new Editor({ extensions: createExtensions(), content: doc });
    expect(findMermaidBlocks(editor.state.doc).map((b) => [b.key, b.node.textContent])).toEqual([
      ["a", "graph TD; A-->B"],
      ["b", "graph LR; C-->D"],
    ]);
    editor.destroy();
  });

  it("adds a preview container after the block and draws it right away", async () => {
    const render = vi.fn();
    const editor = await createEditor(
      { type: "doc", content: [mermaid("graph TD; A-->B")] },
      render,
    );
    await wait(0);
    const pre = editor.view.dom.querySelector("pre")!;
    expect(pre.classList.contains(MERMAID_SOURCE_CLASS)).toBe(true);
    const container = pre.nextElementSibling as HTMLElement;
    expect(container.classList.contains(MERMAID_PREVIEW_CLASS)).toBe(true);
    expect(container.contentEditable).toBe("false");
    expect(render).toHaveBeenCalledExactlyOnceWith("graph TD; A-->B", container);
  });

  it("redraws in the same container after a pause in typing", async () => {
    const render = vi.fn((_code: string, el: HTMLElement) => (el.dataset.state = "ok"));
    const editor = await createEditor({ type: "doc", content: [mermaid("graph TD")] }, render);
    await wait(0);
    const container = editor.view.dom.querySelector(`.${MERMAID_PREVIEW_CLASS}`);
    const end = editor.state.doc.firstChild!.nodeSize - 1;
    editor.commands.insertContentAt(end, ";");
    editor.commands.insertContentAt(end + 1, " A-->B");
    await wait(10);
    expect(render).toHaveBeenCalledTimes(1);
    await wait(80);
    expect(render).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenLastCalledWith("graph TD; A-->B", container);
    expect(editor.view.dom.querySelector(`.${MERMAID_PREVIEW_CLASS}`)).toBe(container);
  });

  it("leaves other code blocks and the document alone", async () => {
    const render = vi.fn();
    const content = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { id: "c", language: "ts" },
          content: [{ type: "text", text: "const a = 1;" }],
        },
      ],
    };
    const editor = await createEditor(content, render);
    await wait(0);
    expect(editor.view.dom.querySelector(`.${MERMAID_PREVIEW_CLASS}`)).toBeNull();
    expect(render).not.toHaveBeenCalled();
    expect(editor.getJSON().content?.[0]).toEqual(content.content[0]);
  });

  it("removes the preview when the block changes language", async () => {
    const editor = await createEditor({ type: "doc", content: [mermaid("graph TD")] });
    editor.commands.command(({ tr }) => {
      tr.setNodeAttribute(0, "language", "ts");
      return true;
    });
    expect(editor.view.dom.querySelector(`.${MERMAID_PREVIEW_CLASS}`)).toBeNull();
    expect(editor.view.dom.querySelector(`.${MERMAID_SOURCE_CLASS}`)).toBeNull();
  });

  it("draws in read-only views", async () => {
    const render = vi.fn();
    await createEditor({ type: "doc", content: [mermaid("graph TD")] }, render, false);
    await wait(0);
    expect(render).toHaveBeenCalledOnce();
  });

  it("slash item inserts a mermaid code block with a starter diagram", async () => {
    const editor = await createEditor("<p>/so do</p>");
    const item = SLASH_ITEMS.find((i) => i.id === "mermaid")!;
    expect(runSlashItem({ editor, range: { from: 1, to: 7 }, item })).toBe(true);
    const block = editor.getJSON().content![0]!;
    expect(block.type).toBe("codeBlock");
    expect(block.attrs?.language).toBe("mermaid");
    expect(editor.state.doc.firstChild?.textContent).toBe(MERMAID_TEMPLATE);
  });

  it("round-trips through Markdown as a ```mermaid fence", () => {
    const md = "```mermaid\ngraph TD\n  A --> B\n```\n";
    const json = markdownToDoc(md);
    expect(json.content?.[0]).toMatchObject({ type: "codeBlock", attrs: { language: "mermaid" } });
    expect(docToMarkdown(json)).toBe(md);
  });
});
