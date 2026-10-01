import { describe, expect, it } from "vitest";

import { diffDocuments, diffWords, summarizeDiff } from "./diff";

const p = (text: string, id?: string) => ({
  type: "paragraph",
  attrs: id ? { id } : {},
  content: [{ type: "text", text }],
});
const doc = (...content: unknown[]) => ({ type: "doc", content });

describe("diffDocuments", () => {
  it("marks identical documents as unchanged", () => {
    const rows = diffDocuments(doc(p("a", "1"), p("b", "2")), doc(p("a", "1"), p("b", "2")));
    expect(rows.map((r) => r.status)).toEqual(["same", "same"]);
  });

  it("detects added, removed and changed blocks", () => {
    const rows = diffDocuments(
      doc(p("one", "1"), p("two", "2"), p("three", "3")),
      doc(p("one", "1"), p("two edited", "2"), p("four", "4")),
    );
    expect(rows.map((r) => r.status)).toEqual(["same", "changed", "removed", "added"]);
    expect(summarizeDiff(rows)).toEqual({ added: 1, removed: 1, changed: 1 });
  });

  it("ignores block IDs when comparing content", () => {
    const rows = diffDocuments(doc(p("a", "x")), doc(p("a", "y")));
    expect(rows[0]?.status).toBe("same");
  });

  it("handles empty documents", () => {
    expect(diffDocuments(null, doc(p("a")))).toMatchObject([{ status: "added" }]);
    expect(diffDocuments(doc(p("a")), undefined)).toMatchObject([{ status: "removed" }]);
  });

  it("renders table text with cell and row separators", () => {
    const cell = (text: string) => ({ type: "tableCell", content: [p(text)] });
    const table = {
      type: "table",
      content: [{ type: "tableRow", content: [cell("A"), cell("B")] }],
    };
    const rows = diffDocuments(doc(), doc(table));
    expect(rows[0]).toMatchObject({ status: "added", after: { text: "A | B" } });
  });
});

describe("diffWords", () => {
  it("marks removed and added words", () => {
    const segments = diffWords("xin chào bạn", "xin chào các bạn");
    expect(segments.filter((s) => s.kind === "added").map((s) => s.text.trim())).toContain("các");
    expect(segments.some((s) => s.kind === "removed")).toBe(false);
  });
});
