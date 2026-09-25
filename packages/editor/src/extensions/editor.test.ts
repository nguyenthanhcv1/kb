// @vitest-environment happy-dom
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from "./index";

const editors: Editor[] = [];

/** Resolves after `onCreate` hooks ran (TipTap defers them, UniqueID fills ids there). */
async function createEditor(content: JSONContent | string, options = {}) {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: createExtensions(options),
    content,
  });
  editors.push(editor);
  await new Promise((resolve) => editor.on("create", resolve));
  return editor;
}

function blockIds(editor: Editor): (string | null)[] {
  const ids: (string | null)[] = [];
  editor.state.doc.descendants((node) => {
    if (node.isBlock) ids.push(node.attrs.id ?? null);
  });
  return ids;
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe("stable block IDs", () => {
  it("assigns a unique id to every block of the initial content", async () => {
    const editor = await createEditor(
      '<h2>Title</h2><p>One</p><ul><li><p>Item</p></li></ul><div data-type="callout"><p>Note</p></div>',
    );
    const ids = blockIds(editor);

    // 4 content blocks + list item + its paragraph + callout paragraph + trailing paragraph
    expect(ids).toHaveLength(8);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps existing ids", async () => {
    const editor = await createEditor({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "keep-me" }, content: [{ type: "text", text: "a" }] },
      ],
    });

    expect(blockIds(editor)).toEqual(["keep-me"]);
  });

  it("gives a new id to a block created by splitting", async () => {
    const editor = await createEditor("<p>Hello world</p>");
    const [original] = blockIds(editor);

    editor.chain().setTextSelection(6).splitBlock().run();
    const ids = blockIds(editor);

    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(original);
    expect(ids[1]).not.toBe(original);
    expect(ids[1]).toBeTruthy();
  });

  it("replaces duplicated ids, e.g. after pasting a copied block", async () => {
    const editor = await createEditor('<p data-id="a">First</p>');
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.view.pasteHTML('<p data-id="a">Copy</p><p>More</p>');
    const ids = blockIds(editor);

    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("a");
  });

  it("renders the id as data-id", async () => {
    const editor = await createEditor('<p data-id="abc">x</p>');
    expect(editor.getHTML()).toContain('data-id="abc"');
  });

  it("leaves read-only documents untouched when updateDocument is false", async () => {
    const editor = await createEditor("<p>x</p>", { uniqueId: { updateDocument: false } });
    expect(blockIds(editor)).toEqual([null]);
  });
});

describe("callout", () => {
  it("wraps and unwraps blocks with toggleCallout", async () => {
    const editor = await createEditor("<p>Note</p>");

    editor.commands.toggleCallout({ variant: "warning" });
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: "callout",
      attrs: { variant: "warning" },
    });

    editor.commands.toggleCallout();
    expect(editor.getJSON().content?.[0]?.type).toBe("paragraph");
  });

  it("falls back to the default variant for unknown values", async () => {
    const editor = await createEditor(
      '<div data-type="callout" data-variant="nope"><p>x</p></div>',
    );
    expect(editor.getJSON().content?.[0]).toMatchObject({ attrs: { variant: "info" } });
  });
});

describe("images", () => {
  it("rejects base64 sources so uploads always go through storage", async () => {
    const editor = await createEditor('<img src="data:image/png;base64,AAAA">');
    expect(editor.getHTML()).not.toContain("data:image");
  });
});
