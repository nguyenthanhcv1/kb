// @vitest-environment happy-dom
import { createExtensions } from "@kb/editor";
import enEditor from "@kb/i18n/messages/en/editor.json";
import viEditor from "@kb/i18n/messages/vi/editor.json";
import { Editor } from "@tiptap/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditorToolbar } from "./editor-toolbar";

const editors: Editor[] = [];

async function setup(content: string, locale: "vi" | "en" = "vi") {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({ element, extensions: createExtensions(), content });
  editors.push(editor);
  await new Promise((resolve) => editor.on("create", resolve));
  const onImage = vi.fn();
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ editor: locale === "vi" ? viEditor : enEditor }}
    >
      <EditorToolbar editor={editor} onImage={onImage} />
    </NextIntlClientProvider>,
  );
  return { editor, onImage };
}

afterEach(() => {
  cleanup();
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = "";
});

describe("EditorToolbar", () => {
  it("is a labelled toolbar with the headings, marks, blocks, table and image", async () => {
    await setup("<p>Xin chào</p>", "en");
    const toolbar = screen.getByRole("toolbar", { name: enEditor.toolbar.label });
    const names = Array.from(toolbar.querySelectorAll("button")).map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(names).toEqual([
      enEditor.slash.items.heading1.title,
      enEditor.slash.items.heading2.title,
      enEditor.slash.items.heading3.title,
      enEditor.bubble.bold,
      enEditor.bubble.italic,
      enEditor.slash.items.bulletList.title,
      enEditor.slash.items.callout.info.title,
      enEditor.slash.items.codeBlock.title,
      enEditor.slash.items.table.title,
      enEditor.slash.items.image.title,
    ]);
  });

  it("turns the block into a heading and back to a paragraph", async () => {
    const user = userEvent.setup();
    const { editor } = await setup("<p>Mục đích</p>");
    act(() => {
      editor.commands.setTextSelection(2);
    });

    const h2 = screen.getByRole("button", { name: viEditor.slash.items.heading2.title });
    await user.click(h2);
    expect(editor.isActive("heading", { level: 2 })).toBe(true);
    expect(h2.getAttribute("aria-pressed")).toBe("true");

    await user.click(h2);
    expect(editor.isActive("heading")).toBe(false);
    expect(h2.getAttribute("aria-pressed")).toBe("false");
  });

  it("toggles bold on the selection and reports it as pressed", async () => {
    const user = userEvent.setup();
    const { editor } = await setup("<p>Quan trọng</p>");
    act(() => {
      editor.commands.selectAll();
    });
    const bold = screen.getByRole("button", { name: viEditor.bubble.bold });
    await user.click(bold);
    expect(editor.isActive("bold")).toBe(true);
    expect(bold.getAttribute("aria-pressed")).toBe("true");
  });

  it("inserts a table, but not inside a table; the image button asks for a URL", async () => {
    const user = userEvent.setup();
    const { editor, onImage } = await setup("<p>Bảng</p>");
    act(() => {
      editor.commands.setTextSelection(2);
    });
    const table = screen.getByRole("button", { name: viEditor.slash.items.table.title });
    await user.click(table);
    expect(editor.getJSON().content?.some((node) => node.type === "table")).toBe(true);
    expect((table as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: viEditor.slash.items.image.title }));
    expect(onImage).toHaveBeenCalledOnce();
  });
});
