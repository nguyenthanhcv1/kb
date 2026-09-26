import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { getEditorSchema } from "../extensions";

import { countWords, extractContent } from "./index";

const p = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
const t = (text: string, marks?: JSONContent["marks"]): JSONContent => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});
const h = (level: number, text: string, id?: string): JSONContent => ({
  type: "heading",
  attrs: { level, ...(id ? { id } : {}) },
  content: [t(text)],
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

const cell = (
  text: string,
  attrs: Record<string, unknown> = {},
  type = "tableCell",
): JSONContent => ({
  type,
  attrs: { colspan: 1, rowspan: 1, ...attrs },
  content: [text ? p(t(text)) : { type: "paragraph" }],
});
const row = (...cells: JSONContent[]): JSONContent => ({ type: "tableRow", content: cells });
const table = (...rows: JSONContent[]): JSONContent => ({ type: "table", content: rows });

describe("extractContent", () => {
  it("returns empty fields for an empty or missing document", () => {
    for (const input of [null, undefined, doc(), doc({ type: "paragraph" })]) {
      expect(extractContent(input)).toEqual({
        contentText: "",
        headingsText: "",
        tableText: "",
        wordCount: 0,
        headings: [],
      });
    }
  });

  it("splits a schema-valid document into body and headings", () => {
    const json = doc(
      h(1, "Quy trình nghỉ phép", "h-1"),
      p(t("Nhân viên "), t("gửi đơn", [{ type: "bold" }]), t(" trước 3 ngày.")),
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [p(t("Bước 1: điền form"))] },
          { type: "listItem", content: [p(t("Bước 2: quản lý duyệt"))] },
        ],
      },
      h(2, "Liên hệ"),
      {
        type: "taskList",
        content: [{ type: "taskItem", attrs: { checked: true }, content: [p(t("Gọi HR"))] }],
      },
      { type: "codeBlock", attrs: { language: "bash" }, content: [t("pnpm dev\n  pnpm test")] },
      { type: "horizontalRule" },
      { type: "image", attrs: { src: "https://example.com/a.png", alt: "Sơ đồ quy trình" } },
      {
        type: "callout",
        attrs: { variant: "info" },
        content: [p(t("Lưu ý"), { type: "hardBreak" }, t("dòng hai"))],
      },
    );

    // The fixture must be a valid document of the shared schema.
    expect(() => getEditorSchema().nodeFromJSON(json).check()).not.toThrow();

    const result = extractContent(json);
    expect(result.contentText).toBe(
      [
        "Nhân viên gửi đơn trước 3 ngày.",
        "Bước 1: điền form",
        "Bước 2: quản lý duyệt",
        "Gọi HR",
        "pnpm dev",
        "pnpm test",
        "Sơ đồ quy trình",
        "Lưu ý",
        "dòng hai",
      ].join("\n"),
    );
    expect(result.headingsText).toBe("Quy trình nghỉ phép\nLiên hệ");
    expect(result.headings).toEqual([
      { id: "h-1", level: 1, text: "Quy trình nghỉ phép" },
      { id: null, level: 2, text: "Liên hệ" },
    ]);
    expect(result.tableText).toBe("");
  });

  it("flattens tables into rows of cells, merged cells once, outside the body text", () => {
    const json = doc(
      p(t("Bảng lương")),
      table(
        row(
          cell("Mã NV", {}, "tableHeader"),
          cell("Họ tên", {}, "tableHeader"),
          cell("Ghi chú", {}, "tableHeader"),
        ),
        row(cell("NV-00123"), cell("Nguyễn Văn An"), cell("Nghỉ phép", { rowspan: 2 })),
        row(cell("NV-00124"), cell("Trần Thị Bình")),
        row(cell("Tổng", { colspan: 2 }), cell("")),
        row(cell(""), cell("")),
      ),
      table(row(cell("a"), cell("b"))),
    );

    const result = extractContent(json);
    expect(result.contentText).toBe("Bảng lương");
    expect(result.tableText).toBe(
      [
        "Mã NV | Họ tên | Ghi chú",
        "NV-00123 | Nguyễn Văn An | Nghỉ phép",
        "NV-00124 | Trần Thị Bình",
        "Tổng | ",
        "",
        "a | b",
      ].join("\n"),
    );
    expect(result.wordCount).toBe(2 + 3 + 3 + 4 + 2 + 1 + 3 + 1 + 1 + 1);
  });

  it("joins multi-block cells with spaces", () => {
    const multi: JSONContent = {
      type: "tableCell",
      content: [
        p(t("dòng một")),
        { type: "bulletList", content: [{ type: "listItem", content: [p(t("ý"))] }] },
      ],
    };
    expect(extractContent(doc(table(row(multi, cell("x"))))).tableText).toBe("dòng một ý | x");
  });

  it("normalises decomposed Vietnamese (NFD) to NFC and collapses whitespace", () => {
    const nfd = "Tiếng   Việt\tcó dấu".normalize("NFD");
    const result = extractContent(doc(p(t(nfd)), h(3, " Hướng dẫn ".normalize("NFD"))));
    expect(result.contentText).toBe("Tiếng Việt có dấu");
    expect(result.contentText).toBe(result.contentText.normalize("NFC"));
    expect(result.headingsText).toBe("Hướng dẫn");
    expect(result.wordCount).toBe(6);
  });

  it("walks unknown blocks generically so new node types still contribute text", () => {
    const json = doc({
      type: "details",
      content: [{ type: "detailsSummary", content: [t("Tóm tắt")] }, p(t("Chi tiết"))],
    });
    expect(extractContent(json).contentText).toBe("Tóm tắt\nChi tiết");
  });

  it("skips empty headings", () => {
    expect(extractContent(doc({ type: "heading", attrs: { level: 1 } })).headings).toEqual([]);
  });
});

describe("countWords", () => {
  it.each([
    ["", 0],
    ["   ", 0],
    ["Xin chào thế giới", 4],
    ["NV-00123 và e-mail", 3],
    ["3.14 | 42", 2],
    ["don't stop", 2],
    ["—, … !", 0],
  ])("%j → %i", (text, expected) => {
    expect(countWords(text)).toBe(expected);
  });
});
