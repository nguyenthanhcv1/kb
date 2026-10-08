// @vitest-environment happy-dom
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BLOCK_ID_TYPES, createExtensions } from "../extensions";
import {
  currentBlockPos,
  deleteBlock,
  duplicateBlock,
  EditorShortcuts,
  filterSlashItems,
  formatShortcutKeys,
  moveBlock,
  runSlashItem,
  SlashCommand,
  SLASH_ITEMS,
  type SlashItem,
} from "./index";

const editors: Editor[] = [];

async function createEditor(
  content: JSONContent | string,
  extra: Editor["extensionManager"]["extensions"] = [],
) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({ element, extensions: [...createExtensions(), ...extra], content });
  editors.push(editor);
  await new Promise((resolve) => editor.on("create", resolve));
  return editor;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Position just inside the first text node equal to `text`. */
function posOf(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text === text) found = pos + 1;
  });
  return found;
}

const texts = (editor: Editor) => {
  const blocks: string[] = [];
  editor.state.doc.forEach((node) => blocks.push(node.textContent));
  return blocks.filter(Boolean);
};

const listItems = (editor: Editor) =>
  ((editor.getJSON() as JSONContent).content?.[0]?.content ?? []) as JSONContent[];

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = "";
});

// Fake labels: the real ones come from next-intl in the web app.
const labels: Record<string, string> = {
  heading1: "Tiêu đề 1",
  heading2: "Tiêu đề 2",
  heading3: "Tiêu đề 3",
  paragraph: "Văn bản",
};
const label = (item: SlashItem) => labels[item.id] ?? item.id;

describe("slash items", () => {
  it("has unique ids", () => {
    const ids = SLASH_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(SLASH_ITEMS.map((item) => [item.id, item] as const))(
    "%s replaces the /query text and creates its block",
    async (_id, item) => {
      const editor = await createEditor("<p>/abc</p>");
      const ok = runSlashItem(
        { editor, range: { from: 1, to: 5 }, item },
        { src: "https://example.com/a.png" },
      );
      expect(ok).toBe(true);
      const json = JSON.stringify(editor.getJSON());
      expect(json).not.toContain("/abc");
      const expected: Record<string, string> = {
        paragraph: "paragraph",
        heading1: "heading",
        heading2: "heading",
        heading3: "heading",
        divider: "horizontalRule",
        file: "paragraph",
        mermaid: "codeBlock",
      };
      const type = expected[item.id] ?? item.id.split(".")[0];
      expect(json).toContain(`"type":"${type}"`);
    },
  );

  it("puts the caret after an inserted image", async () => {
    const editor = await createEditor("<p>/img</p><p>next</p>");
    const image = SLASH_ITEMS.find((item) => item.id === "image")!;
    runSlashItem(
      { editor, range: { from: 1, to: 5 }, item: image },
      { src: "https://e.com/a.png" },
    );
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.state.selection.$from.parent.textContent).toBe("next");
    expect(editor.getJSON().content?.[0]?.type).toBe("image");
  });

  it("covers every block type of the schema", () => {
    const created = new Set(
      SLASH_ITEMS.map(
        (item) =>
          ({ divider: "horizontalRule", mermaid: "codeBlock" })[item.id] ??
          item.id.replace(/\d$|\..*$/, ""),
      ),
    );
    // List items, table rows and cells come with their parent; the rest must be reachable from "/".
    const parts = new Set(["listItem", "taskItem", "tableRow", "tableHeader", "tableCell"]);
    const blocks = BLOCK_ID_TYPES.filter((type) => !parts.has(type));
    expect(blocks.filter((type) => !created.has(type))).toEqual([]);
  });

  it("filters by translated label and keywords, ignoring accents", () => {
    expect(filterSlashItems(SLASH_ITEMS, "tieu de 2", label).map((i) => i.id)).toEqual([
      "heading2",
    ]);
    expect(filterSlashItems(SLASH_ITEMS, "Tiêu", label).map((i) => i.id)).toEqual([
      "heading1",
      "heading2",
      "heading3",
    ]);
    expect(filterSlashItems(SLASH_ITEMS, "todo", label).map((i) => i.id)).toEqual(["taskList"]);
    expect(filterSlashItems(SLASH_ITEMS, "canh bao", label).map((i) => i.id)).toEqual([
      "callout.warning",
    ]);
    expect(filterSlashItems(SLASH_ITEMS, "", label)).toHaveLength(SLASH_ITEMS.length);
    expect(filterSlashItems(SLASH_ITEMS, "zzz", label)).toEqual([]);
  });

  it("ranks items whose label starts with the query first", () => {
    const ids = filterSlashItems(SLASH_ITEMS, "van", label).map((i) => i.id);
    expect(ids[0]).toBe("paragraph");
  });
});

describe("SlashCommand extension", () => {
  function type(editor: Editor, text: string) {
    const { from } = editor.state.selection;
    editor.view.dispatch(editor.state.tr.insertText(text, from));
  }

  it("opens on '/' with the items for the query and runs the picked one", async () => {
    const onStart = vi.fn();
    const onUpdate = vi.fn();
    const editor = await createEditor("<p></p>", [
      SlashCommand.configure({
        items: (query) => filterSlashItems(SLASH_ITEMS, query, label),
        render: () => ({ onStart, onUpdate }),
      }),
    ]);
    editor.commands.focus("end");
    type(editor, "/");
    expect(onStart).toHaveBeenCalledOnce();
    type(editor, "h2");
    await tick(); // items resolve asynchronously
    const props = onUpdate.mock.lastCall?.[0];
    expect(props.items.map((i: SlashItem) => i.id)).toEqual(["heading2"]);

    props.command(props.items[0]);
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: "heading", attrs: { level: 2 } });
    expect(editor.state.doc.textContent).toBe("");
  });

  it("keeps the menu open for multi-word queries that match, closes otherwise", async () => {
    const onUpdate = vi.fn();
    const onExit = vi.fn();
    const editor = await createEditor("<p></p>", [
      SlashCommand.configure({
        items: (query) => filterSlashItems(SLASH_ITEMS, query, label),
        render: () => ({ onUpdate, onExit }),
      }),
    ]);
    editor.commands.focus("end");
    type(editor, "/tieu de 2");
    await tick();
    expect(onUpdate.mock.lastCall?.[0].items.map((i: SlashItem) => i.id)).toEqual(["heading2"]);
    expect(onExit).not.toHaveBeenCalled();

    type(editor, " xyz");
    await tick();
    expect(onExit).toHaveBeenCalled();
  });

  it("does not open inside a code block", async () => {
    const onStart = vi.fn();
    const editor = await createEditor("<pre><code>x</code></pre>", [
      SlashCommand.configure({ render: () => ({ onStart }) }),
    ]);
    editor.commands.setTextSelection(2); // after "x" (StarterKit adds a trailing paragraph)
    type(editor, " /");
    await tick();
    expect(onStart).not.toHaveBeenCalled();
  });
});

describe("block actions", () => {
  it("moves a top-level block up and down, keeping the cursor in it", async () => {
    const editor = await createEditor("<p>A</p><p>B</p><p>C</p>");
    editor.commands.setTextSelection(5); // inside "B"
    const pos = currentBlockPos(editor.state)!;
    expect(moveBlock(editor, pos, "up")).toBe(true);
    expect(texts(editor)).toEqual(["B", "A", "C"]);
    expect(editor.state.selection.$from.parent.textContent).toBe("B");

    const next = currentBlockPos(editor.state)!;
    expect(moveBlock(editor, next, "up")).toBe(false);
    expect(moveBlock(editor, next, "down")).toBe(true);
    expect(moveBlock(editor, currentBlockPos(editor.state)!, "down")).toBe(true);
    expect(texts(editor)).toEqual(["A", "C", "B"]);
    expect(moveBlock(editor, currentBlockPos(editor.state)!, "down")).toBe(false);
  });

  it("moves a list item inside its list and keeps its block id", async () => {
    const editor = await createEditor("<ul><li><p>one</p></li><li><p>two</p></li></ul>");
    const second = listItems(editor)[1];
    editor.commands.setTextSelection(posOf(editor, "two"));
    expect(moveBlock(editor, currentBlockPos(editor.state)!, "up")).toBe(true);
    const items = listItems(editor);
    expect(items.map((li) => li.content?.[0]?.content?.[0]?.text)).toEqual(["two", "one"]);
    expect(items[0]?.attrs?.id).toBe(second?.attrs?.id);
  });

  it("duplicates a block with fresh ids", async () => {
    const editor = await createEditor("<blockquote><p>Q</p></blockquote><p>end</p>");
    expect(duplicateBlock(editor, 0)).toBe(true);
    const [a, b] = editor.getJSON().content as [JSONContent, JSONContent];
    expect(b).toMatchObject({ type: "blockquote" });
    expect(b.attrs?.id).toBeTruthy();
    expect(b.attrs?.id).not.toBe(a.attrs?.id);
    expect(b.content?.[0]?.attrs?.id).not.toBe(a.content?.[0]?.attrs?.id);
  });

  it("deletes a block and never leaves an empty document", async () => {
    const editor = await createEditor("<p>only</p>");
    expect(deleteBlock(editor, 0)).toBe(true);
    expect(editor.getJSON().content).toHaveLength(1);
    expect(editor.getText()).toBe("");
  });
});

describe("EditorShortcuts", () => {
  it("wires Mod-K and Mod-/ to the UI and moves blocks with Mod-Shift-Arrow", async () => {
    const onLinkShortcut = vi.fn(() => true);
    const onHelpShortcut = vi.fn(() => true);
    const editor = await createEditor("<p>A</p><p>B</p>", [
      EditorShortcuts.configure({ onLinkShortcut, onHelpShortcut }),
    ]);
    const press = (key: string, init: KeyboardEventInit) =>
      editor.view.someProp("handleKeyDown", (f) =>
        f(editor.view, new KeyboardEvent("keydown", { key, ...init })),
      );
    press("k", { ctrlKey: true });
    press("/", { ctrlKey: true });
    expect(onLinkShortcut).toHaveBeenCalledOnce();
    expect(onHelpShortcut).toHaveBeenCalledOnce();

    editor.commands.setTextSelection(4); // inside "B"
    press("ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(texts(editor)).toEqual(["B", "A"]);
  });

  it("formats keys for macOS and other platforms", () => {
    expect(formatShortcutKeys(["Mod", "Shift", "Z"], true)).toEqual(["⌘", "⇧", "Z"]);
    expect(formatShortcutKeys(["Mod", "Alt", "1"], false)).toEqual(["Ctrl", "Alt", "1"]);
  });
});
