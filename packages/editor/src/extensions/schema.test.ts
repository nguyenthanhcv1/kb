import { createHash } from "node:crypto";

import { type Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { EDITOR_SCHEMA_VERSION } from "../schema-version";

import { BLOCK_ID_TYPES, getEditorSchema } from "./index";

/**
 * Fingerprint of the schema for each released `EDITOR_SCHEMA_VERSION`.
 * Changing the schema without bumping the version breaks Yjs documents written
 * by older clients, so a schema change must: bump `EDITOR_SCHEMA_VERSION`, add
 * its fingerprint here (keep the old ones) and update the snapshot.
 */
const SCHEMA_FINGERPRINTS: Record<number, string> = {
  1: "767dc01fea72e07c52b7808286dd3d4130a2482b481c29b545297e9157ec47a4",
  // T4.1: table, tableRow, tableHeader, tableCell (additive — v1 documents load unchanged).
  2: "864d36d1216cab63f330f98fd130e1422d4f66deaeb3c163ba44b2b493aa8e91",
};

function describeSchema(schema: Schema) {
  const attrs = (spec: { attrs?: Record<string, { default?: unknown }> }) =>
    Object.fromEntries(
      Object.entries(spec.attrs ?? {}).map(([name, attr]) => [
        name,
        "default" in attr ? attr.default : "<required>",
      ]),
    );

  const nodes: Record<string, unknown> = {};
  schema.spec.nodes.forEach((name, spec) => {
    nodes[name] = {
      group: spec.group ?? null,
      content: spec.content ?? null,
      marks: spec.marks ?? null,
      inline: spec.inline ?? false,
      atom: spec.atom ?? false,
      attrs: attrs(spec),
    };
  });

  const marks: Record<string, unknown> = {};
  schema.spec.marks.forEach((name, spec) => {
    marks[name] = {
      excludes: spec.excludes ?? null,
      inclusive: spec.inclusive ?? true,
      attrs: attrs(spec),
    };
  });

  return { topNode: schema.spec.topNode ?? "doc", nodes, marks };
}

describe("editor schema", () => {
  const schema = getEditorSchema();
  const description = describeSchema(schema);

  it("builds without a DOM (server-side import)", () => {
    expect(typeof document).toBe("undefined");
    expect(schema.topNodeType.name).toBe("doc");
  });

  it("matches the snapshot", () => {
    expect(description).toMatchSnapshot();
  });

  it("matches the fingerprint recorded for EDITOR_SCHEMA_VERSION", () => {
    const fingerprint = createHash("sha256").update(JSON.stringify(description)).digest("hex");
    expect(
      fingerprint,
      "Schema changed: bump EDITOR_SCHEMA_VERSION and record the new fingerprint",
    ).toBe(SCHEMA_FINGERPRINTS[EDITOR_SCHEMA_VERSION]);
  });

  it("gives every block node a stable id attribute", () => {
    const blockNodes = Object.values(schema.nodes)
      .filter((type) => type.isBlock && type !== schema.topNodeType)
      .map((type) => type.name);

    expect([...blockNodes].sort()).toEqual([...BLOCK_ID_TYPES].sort());
    for (const name of BLOCK_ID_TYPES) {
      expect(schema.nodes[name]?.spec.attrs?.id).toEqual(
        expect.objectContaining({ default: null }),
      );
    }
  });

  it("accepts a document using every block type", () => {
    const text = (value: string) => ({ type: "text", text: value });
    const paragraph = (value: string) => ({ type: "paragraph", content: [text(value)] });

    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1, id: "h1" }, content: [text("Tiêu đề")] },
        {
          type: "paragraph",
          content: [
            text("Xin chào "),
            { type: "text", text: "thế giới", marks: [{ type: "bold" }, { type: "italic" }] },
            {
              type: "text",
              text: " link",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
        { type: "bulletList", content: [{ type: "listItem", content: [paragraph("a")] }] },
        { type: "orderedList", content: [{ type: "listItem", content: [paragraph("b")] }] },
        {
          type: "taskList",
          content: [{ type: "taskItem", attrs: { checked: true }, content: [paragraph("c")] }],
        },
        { type: "codeBlock", attrs: { language: "ts" }, content: [text("const a = 1;")] },
        { type: "blockquote", content: [paragraph("quote")] },
        { type: "callout", attrs: { variant: "warning" }, content: [paragraph("careful")] },
        { type: "horizontalRule" },
        { type: "image", attrs: { src: "https://example.com/a.png", alt: "a" } },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [paragraph("Mã")] },
                { type: "tableHeader", attrs: { colwidth: [120] }, content: [paragraph("Tên")] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [paragraph("1")] },
                { type: "tableCell", attrs: { colspan: 1 }, content: [paragraph("An")] },
              ],
            },
          ],
        },
      ],
    });

    expect(() => doc.check()).not.toThrow();
    expect(doc.firstChild?.attrs.id).toBe("h1");
  });
});
