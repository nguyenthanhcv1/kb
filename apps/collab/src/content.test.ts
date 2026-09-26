import { getEditorSchema } from "@kb/editor";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { deriveContent, DOCUMENT_FIELD } from "./content";

describe("deriveContent", () => {
  it("returns an empty document for a new Y.Doc", () => {
    const result = deriveContent(new Y.Doc());
    expect(result.contentJson).toMatchObject({ type: "doc" });
    expect(result.contentText).toBe("");
    expect(result.wordCount).toBe(0);
  });

  it("derives TipTap JSON and text from the Yjs fragment", () => {
    const doc = new Y.Doc();
    const heading = new Y.XmlElement("heading");
    heading.setAttribute("level", 2 as unknown as string);
    heading.insert(0, [new Y.XmlText("Quy trình")]);
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("Xin chào thế giới")]);
    doc.getXmlFragment(DOCUMENT_FIELD).insert(0, [heading, paragraph]);

    const result = deriveContent(doc);
    expect(result.headingsText).toBe("Quy trình");
    expect(result.contentText).toBe("Xin chào thế giới");
    expect(result.wordCount).toBe(6);
    expect(result.contentJson).toMatchObject({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 } },
        { type: "paragraph", content: [{ type: "text", text: "Xin chào thế giới" }] },
      ],
    });
  });

  it("keeps tables (T4.1): cells, column widths and block ids survive Yjs, text goes to tableText", () => {
    const cell = (type: string, text: string, attrs: Record<string, unknown> = {}) => ({
      type,
      attrs,
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const table = {
      type: "table",
      attrs: { id: "tbl" },
      content: [
        {
          type: "tableRow",
          content: [
            cell("tableHeader", "Mã NV", { colwidth: [120], id: "h1" }),
            cell("tableHeader", "Họ tên"),
          ],
        },
        { type: "tableRow", content: [cell("tableCell", "NV-001"), cell("tableCell", "An")] },
      ],
    };
    const doc = prosemirrorJSONToYDoc(
      getEditorSchema(),
      { type: "doc", content: [table] },
      DOCUMENT_FIELD,
    );

    const result = deriveContent(doc);
    expect(result.tableText).toBe("Mã NV | Họ tên\nNV-001 | An");
    expect(result.contentText).toBe("");
    expect(result.contentJson).toMatchObject({
      content: [
        {
          type: "table",
          attrs: { id: "tbl" },
          content: [
            {
              type: "tableRow",
              content: [{ type: "tableHeader", attrs: { colwidth: [120], id: "h1" } }, {}],
            },
            {},
          ],
        },
      ],
    });
  });
});
