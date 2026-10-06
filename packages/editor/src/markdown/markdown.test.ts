import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { getEditorSchema } from "../extensions";

import {
  applyBlockEdits,
  assertValidDocument,
  assignBlockIds,
  BlockEditError,
  docToMarkdown,
  listBlocks,
  markdownToDoc,
  reuseUnchangedBlocks,
} from "./index";

const schema = getEditorSchema();

/** Parses with the real schema (fills default attrs) and back to JSON. */
const normalize = (doc: JSONContent) => schema.nodeFromJSON(doc).toJSON() as JSONContent;

const roundTrip = (markdown: string) => docToMarkdown(normalize(markdownToDoc(markdown)));

let counter = 0;
const ids = () => `id-${++counter}`;

describe("markdownToDoc", () => {
  it("parses the common blocks into a schema-valid document", () => {
    const doc = markdownToDoc(
      [
        "# Nghỉ phép",
        "",
        "Đoạn **đậm**, *nghiêng*, ~~gạch~~, <u>gạch chân</u>, `mã` và [liên kết](https://kb.example.com).",
        "",
        "- một",
        "- hai",
        "  1. con",
        "",
        "* [x] xong",
        "* [ ] chưa",
        "",
        "> trích dẫn",
        "",
        "```ts",
        "const a = 1;",
        "```",
        "",
        "---",
        "",
        "![sơ đồ](https://kb.example.com/a.png)",
        "",
        "| Họ tên | Số ngày |",
        "| --- | --- |",
        "| An | 12 |",
      ].join("\n"),
    );
    expect(() => assertValidDocument(doc)).not.toThrow();
    expect(doc.content?.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "bulletList",
      "taskList",
      "blockquote",
      "codeBlock",
      "horizontalRule",
      "image",
      "table",
    ]);
    const marks = doc.content![1]!.content!.flatMap((node) => node.marks?.map((m) => m.type) ?? []);
    expect(marks).toEqual(["bold", "italic", "strike", "underline", "code", "link"]);
    expect(doc.content![3]!.content!.map((item) => item.attrs?.checked)).toEqual([true, false]);
    expect(doc.content![8]!.content![0]!.content![0]!.type).toBe("tableHeader");
  });

  it("turns GitHub alerts into callouts", () => {
    const doc = markdownToDoc("> [!WARNING]\n> Cẩn thận\n\n> [!TIP]\n> Mẹo");
    expect(doc.content).toEqual([
      {
        type: "callout",
        attrs: { variant: "warning" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "Cẩn thận" }] }],
      },
      {
        type: "callout",
        attrs: { variant: "success" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "Mẹo" }] }],
      },
    ]);
  });

  it("clamps deep headings, lifts inline images and keeps an empty doc valid", () => {
    expect(markdownToDoc("#### Sâu").content![0]!.attrs).toEqual({ level: 3 });
    const doc = markdownToDoc("trước ![ảnh](https://x.test/a.png) sau");
    expect(doc.content!.map((block) => block.type)).toEqual(["paragraph", "image", "paragraph"]);
    expect(markdownToDoc("")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(() => assertValidDocument(doc)).not.toThrow();
  });

  it("gives list items that start with a block an empty first paragraph", () => {
    const doc = markdownToDoc("- ```\n  code\n  ```");
    expect(() => assertValidDocument(doc)).not.toThrow();
  });
});

describe("docToMarkdown", () => {
  it.each([
    "# Tiêu đề\n",
    "Đoạn **đậm** và *nghiêng* và ~~gạch~~ và <u>chân</u> và `mã`.\n",
    "[liên kết **đậm**](https://kb.example.com)\n",
    "- một\n- hai\n  - con\n",
    "3. ba\n4. bốn\n",
    "- [x] xong\n- [ ] chưa\n",
    "> trích dẫn\n",
    "> [!CAUTION]\n> Nguy hiểm\n",
    "```ts\nconst a = 1;\n```\n",
    "---\n",
    '![sơ đồ](https://kb.example.com/a.png "Tiêu đề")\n',
    "| Họ tên | Số ngày |\n| --- | --- |\n| An | 12 |\n",
    "dòng một\\\ndòng hai\n",
  ])("round-trips %j", (markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("escapes text that would read as Markdown syntax", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "# không phải tiêu đề *x* [y]" }] },
        { type: "paragraph", content: [{ type: "text", text: "1. không phải danh sách" }] },
      ],
    };
    const markdown = docToMarkdown(doc);
    expect(markdown).toBe("\\# không phải tiêu đề \\*x\\* \\[y\\]\n\n1\\. không phải danh sách\n");
    expect(normalize(markdownToDoc(markdown)).content).toEqual(normalize(doc).content);
  });

  it("moves spaces outside emphasis delimiters", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a" },
            { type: "text", text: " b ", marks: [{ type: "bold" }] },
            { type: "text", text: "c" },
          ],
        },
      ],
    };
    expect(docToMarkdown(doc)).toBe("a **b** c\n");
  });

  it("writes tables without a header row and with rich cells on one line", () => {
    const cell = (text: string): JSONContent => ({
      type: "tableCell",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            { type: "tableRow", content: [cell("a|b"), cell("c")] },
            { type: "tableRow", content: [cell("d")] },
          ],
        },
      ],
    };
    expect(docToMarkdown(doc)).toBe("| a\\|b | c |\n| --- | --- |\n| d |  |\n");
  });
});

describe("block helpers", () => {
  it("assigns missing IDs and replaces duplicates", () => {
    const doc = assignBlockIds(
      {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { id: "keep" } },
          { type: "paragraph", attrs: { id: "keep" } },
          { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
        ],
      },
      ids,
    );
    expect(doc.content![0]!.attrs!.id).toBe("keep");
    expect(doc.content![1]!.attrs!.id).not.toBe("keep");
    expect(doc.content![2]!.content![0]!.content![0]!.attrs!.id).toMatch(/^id-/);
  });

  it("keeps stored blocks whose Markdown did not change", () => {
    const stored: JSONContent = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "giữ" }] },
        { type: "paragraph", attrs: { id: "p2" }, content: [{ type: "text", text: "đổi" }] },
      ],
    };
    const next = reuseUnchangedBlocks(stored, markdownToDoc("giữ\n\nđã đổi"));
    expect(next.content![0]).toBe(stored.content![0]);
    expect(next.content![1]!.attrs?.id).toBeUndefined();
  });

  it("lists blocks and applies edits by ID", () => {
    const stored = assignBlockIds(markdownToDoc("một\n\nhai\n\nba"), ids);
    const blocks = listBlocks(stored);
    expect(blocks.map((block) => block.markdown)).toEqual(["một", "hai", "ba"]);

    const edited = applyBlockEdits(stored, [
      { op: "replace", blockId: blocks[1]!.id!, markdown: "## Hai" },
      { op: "insert", afterBlockId: null, markdown: "đầu" },
      { op: "delete", blockId: blocks[2]!.id! },
      { op: "append", markdown: "cuối" },
    ]);
    expect(docToMarkdown(edited)).toBe("đầu\n\nmột\n\n## Hai\n\ncuối\n");
    expect(edited.content![1]).toBe(stored.content![0]);
    expect(() => applyBlockEdits(stored, [{ op: "delete", blockId: "nope" }])).toThrow(
      BlockEditError,
    );
  });

  it("rejects documents outside the schema", () => {
    expect(() =>
      assertValidDocument({ type: "doc", content: [{ type: "text", text: "x" }] }),
    ).toThrow(BlockEditError);
  });
});
