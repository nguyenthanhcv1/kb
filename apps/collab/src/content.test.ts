import { getEditorSchema } from "@kb/editor";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { deriveContent, DOCUMENT_FIELD, parseContentJson, replaceContent } from "./content";

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

  it("keeps tables (T4.1, T4.2): cells, column widths, colours and block ids survive Yjs, text goes to tableText", () => {
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
            cell("tableHeader", "Họ tên", { backgroundColor: "blue" }),
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
              content: [
                {
                  type: "tableHeader",
                  attrs: { colwidth: [120], id: "h1", backgroundColor: null },
                },
                { type: "tableHeader", attrs: { backgroundColor: "blue" } },
              ],
            },
            {},
          ],
        },
      ],
    });
  });
});

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("parseContentJson / replaceContent", () => {
  it("rejects JSON outside the editor schema", () => {
    expect(() => parseContentJson({ type: "doc", content: [{ type: "unknownBlock" }] })).toThrow();
    expect(() =>
      parseContentJson({ type: "doc", content: [{ type: "text", text: "x" }] }),
    ).toThrow();
    expect(() => parseContentJson(paragraph("not a doc"))).toThrow();
    expect(() =>
      parseContentJson({
        type: "doc",
        content: [{ type: "paragraph", marks: [{ type: "nope" }] }],
      }),
    ).toThrow();
  });

  it("replaces the whole fragment in one update, keeping unchanged blocks", () => {
    const doc = new Y.Doc();
    replaceContent(
      doc,
      parseContentJson({ type: "doc", content: [paragraph("Giữ"), paragraph("Cũ")] }),
    );
    const kept = doc.getXmlFragment(DOCUMENT_FIELD).get(0);

    const updates: Uint8Array[] = [];
    doc.on("update", (update: Uint8Array) => updates.push(update));
    doc.transact(() => {
      replaceContent(
        doc,
        parseContentJson({
          type: "doc",
          content: [
            paragraph("Giữ"),
            { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Mới" }] },
          ],
        }),
      );
    });

    expect(updates).toHaveLength(1);
    expect(doc.getXmlFragment(DOCUMENT_FIELD).get(0)).toBe(kept);
    const { contentJson, contentText, headingsText } = deriveContent(doc);
    expect(headingsText).toBe("Mới");
    expect(contentText).toBe("Giữ");
    expect(contentJson).toMatchObject({
      content: [paragraph("Giữ"), { type: "heading", attrs: { level: 2 } }],
    });
    expect((contentJson.content as unknown[]).length).toBe(2);
  });

  it("can empty a document", () => {
    const doc = new Y.Doc();
    replaceContent(doc, parseContentJson({ type: "doc", content: [paragraph("Có chữ")] }));
    replaceContent(doc, parseContentJson({ type: "doc", content: [{ type: "paragraph" }] }));
    expect(deriveContent(doc).contentText).toBe("");
  });
});
