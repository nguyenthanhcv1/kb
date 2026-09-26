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
});
