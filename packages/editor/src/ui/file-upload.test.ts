// @vitest-environment happy-dom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createExtensions } from "../extensions";
import {
  attachmentHref,
  FileUpload,
  insertAttachment,
  parseAttachmentHref,
  stripBase64Images,
} from "./index";

const ID = "3000a000-0000-4000-8000-000000000001";
const editors: Editor[] = [];

function createEditor(onFiles = vi.fn(), content = "<p>hello</p>") {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    content,
    extensions: [...createExtensions(), FileUpload.configure({ onFiles })],
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

function clipboardEvent(files: File[], html = "") {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.assign(event, {
    clipboardData: { files, getData: (t: string) => (t === "text/html" ? html : "") },
  });
  return event;
}

describe("attachment paths", () => {
  it("round-trips ids", () => {
    expect(attachmentHref(ID)).toBe(`/api/attachments/${ID}`);
    expect(attachmentHref(ID, { download: true })).toBe(`/api/attachments/${ID}?download=1`);
    expect(parseAttachmentHref(attachmentHref(ID, { download: true }))).toBe(ID);
    expect(parseAttachmentHref("https://example.com/a.png")).toBeNull();
    expect(parseAttachmentHref("/api/attachments/../x")).toBeNull();
  });
});

describe("stripBase64Images", () => {
  it("removes data: images but keeps others", () => {
    const html = '<p>a<img src="data:image/png;base64,AAAA">b<img src="https://e.com/x.png"></p>';
    expect(stripBase64Images(html)).toBe('<p>ab<img src="https://e.com/x.png"></p>');
  });
});

describe("FileUpload", () => {
  it("hands pasted files to onFiles instead of the document", () => {
    const onFiles = vi.fn();
    const editor = createEditor(onFiles);
    const file = new File(["x"], "a.png", { type: "image/png" });
    const event = clipboardEvent([file]);
    editor.view.dom.dispatchEvent(event);
    expect(onFiles).toHaveBeenCalledWith([file], null);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getText()).toBe("hello");
  });

  it("ignores pastes without files", () => {
    const onFiles = vi.fn();
    const editor = createEditor(onFiles);
    editor.view.dom.dispatchEvent(clipboardEvent([]));
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("does not parse base64 images from pasted HTML", () => {
    const editor = createEditor();
    editor.commands.setContent('<p><img src="data:image/png;base64,AAAA"></p>');
    expect(JSON.stringify(editor.getJSON())).not.toContain("data:");
  });
});

describe("insertAttachment", () => {
  it("inserts an image that points at the attachment, not at bytes", () => {
    const editor = createEditor();
    insertAttachment(editor, { id: ID, fileName: "Sơ đồ.png", isImage: true }, null);
    const image = editor.getJSON().content?.find((node) => node.type === "image");
    expect(image?.attrs).toMatchObject({ src: `/api/attachments/${ID}`, alt: "Sơ đồ.png" });
  });

  it("inserts a download link for other files", () => {
    const editor = createEditor();
    insertAttachment(editor, { id: ID, fileName: "bao-cao.pdf", isImage: false }, null);
    const html = editor.getHTML();
    expect(html).toContain(`href="/api/attachments/${ID}?download=1"`);
    expect(html).toContain("bao-cao.pdf");
  });

  it("inserts at the drop position", () => {
    const editor = createEditor(vi.fn(), "<p>one</p><p>two</p>");
    insertAttachment(editor, { id: ID, fileName: "a.png", isImage: true }, 1);
    expect(
      editor.getJSON().content?.[0]?.type === "image" ||
        editor.getJSON().content?.[1]?.type === "image",
    ).toBe(true);
  });
});
