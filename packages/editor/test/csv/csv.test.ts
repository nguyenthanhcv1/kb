import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import {
  CSV_BOM,
  tableJsonToCsv,
  tableNodeToCsv,
  type TableToCsvOptions,
} from "../../src/table/csv";
import { br, p, row, schema, table, td, th } from "./fixtures";

const PLAIN: TableToCsvOptions = { bom: false };
const csv = (t: JSONContent, options: TableToCsvOptions = {}) =>
  tableJsonToCsv(t, { ...PLAIN, ...options });

describe("tableJsonToCsv — basics", () => {
  it("exports rows as CRLF-separated records with no trailing line ending", () => {
    const t = table(row("a", "b", "c"), row("1", "2", "3"));
    expect(csv(t)).toBe("a,b,c\r\n1,2,3");
  });

  it("supports LF line endings", () => {
    const t = table(row("a", "b"), row("1", "2"));
    expect(csv(t, { lineEnding: "\n" })).toBe("a,b\n1,2");
  });

  it("prepends a UTF-8 BOM by default and omits it when bom is false", () => {
    const t = table(row("x"));
    expect(tableJsonToCsv(t)).toBe(`${CSV_BOM}x`);
    expect(tableJsonToCsv(t).charCodeAt(0)).toBe(0xfeff);
    expect(new TextEncoder().encode(tableJsonToCsv(t)).slice(0, 3)).toEqual(
      new Uint8Array([0xef, 0xbb, 0xbf]),
    );
    expect(tableJsonToCsv(t, { bom: false })).toBe("x");
  });

  it("treats header cells like body cells", () => {
    const t = table(row(th("Tên"), th("Tuổi")), row("An", "30"));
    expect(csv(t)).toBe("Tên,Tuổi\r\nAn,30");
  });

  it("returns only the BOM (or nothing) for an empty table", () => {
    expect(tableJsonToCsv({ type: "table" })).toBe(CSV_BOM);
    expect(csv({ type: "table", content: [] })).toBe("");
    expect(csv(table(row()))).toBe("");
    expect(csv(table(row(td(p()))))).toBe("");
  });

  it("keeps empty cells as empty fields", () => {
    const t = table(row(td(p()), "b", td(p())));
    expect(csv(t)).toBe(",b,");
  });

  it("pads short rows so every record has the same number of fields", () => {
    const t = table(row("a", "b", "c"), row("1"));
    expect(csv(t)).toBe("a,b,c\r\n1,,");
  });

  it("ignores non-row / non-cell children", () => {
    const t: JSONContent = {
      type: "table",
      content: [{ type: "paragraph" }, row("a", "b"), { type: "tableRow", content: [p("stray")] }],
    };
    expect(csv(t)).toBe("a,b\r\n,");
  });
});

describe("tableJsonToCsv — RFC 4180 quoting", () => {
  it("quotes fields with commas, quotes, CR or LF and doubles inner quotes", () => {
    const t = table(row("a,b", 'say "hi"', "x\ry", "plain"));
    expect(csv(t)).toBe('"a,b","say ""hi""","x\ry",plain');
  });

  it("quotes fields with leading or trailing whitespace", () => {
    const t = table(row(" lead", "trail ", "mid dle"));
    expect(csv(t)).toBe('" lead","trail ",mid dle');
  });

  it("does not quote semicolons or apostrophes", () => {
    expect(csv(table(row("a;b", "it's")))).toBe("a;b,it's");
  });
});

describe("tableJsonToCsv — cell text", () => {
  it("joins paragraphs, hard breaks and list items with LF inside quotes", () => {
    const list: JSONContent = {
      type: "bulletList",
      content: [
        { type: "listItem", content: [p("một")] },
        { type: "listItem", content: [p("hai")] },
      ],
    };
    const t = table(
      row(td([p("dòng 1"), p("dòng 2")]), td(p("a", br, "b")), td([p("Danh sách:"), list])),
    );
    // LF inside a cell stays LF even with CRLF record separators.
    expect(csv(t)).toBe('"dòng 1\ndòng 2","a\nb","Danh sách:\nmột\nhai"');
  });

  it("drops marks and uses the label/text of inline atoms", () => {
    const t = table(
      row(
        td(
          p(
            { type: "text", text: "Đậm", marks: [{ type: "bold" }] },
            " và ",
            { type: "mention", attrs: { id: "u1", label: "@Lan" } },
            " ",
            { type: "emoji", attrs: { text: "🙂" } },
          ),
        ),
        td({ type: "image", attrs: { src: "x.png", alt: "Sơ đồ" } }),
        td({ type: "horizontalRule" }),
      ),
    );
    expect(csv(t)).toBe("Đậm và @Lan 🙂,Sơ đồ,");
  });

  it("trims empty paragraphs at the edges but keeps inner blank lines", () => {
    const t = table(row(td([p(), p("a"), p(), p("b"), p()])));
    expect(csv(t)).toBe('"a\n\nb"');
  });

  it("keeps code block newlines", () => {
    const code: JSONContent = {
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [{ type: "text", text: "const a = 1;\nconst b = 2;" }],
    };
    expect(csv(table(row(td(code))))).toBe('"const a = 1;\nconst b = 2;"');
  });

  it("normalises Vietnamese text to NFC", () => {
    const decomposed = "Tiếng Việt có dấu".normalize("NFD");
    expect(decomposed).not.toBe("Tiếng Việt có dấu");
    const out = csv(table(row(decomposed)));
    expect(out).toBe("Tiếng Việt có dấu");
    expect(out).toBe(out.normalize("NFC"));
  });
});

describe("tableJsonToCsv — merged cells", () => {
  // ┌─────────┬───┐
  // │ A (2×2) │ B │
  // │         ├───┤
  // │         │ C │
  // ├───┬─────┴───┤
  // │ D │ E (1×2) │
  // └───┴─────────┘
  const merged = table(
    row(td("A", { colspan: 2, rowspan: 2 }), "B"),
    row("C"),
    row("D", td("E", { colspan: 2 })),
  );

  it("puts the value in the top-left position and leaves covered positions empty by default", () => {
    expect(csv(merged)).toBe("A,,B\r\n,,C\r\nD,E,");
  });

  it("repeats the value in every covered position with mergedCells: repeat", () => {
    expect(csv(merged, { mergedCells: "repeat" })).toBe("A,A,B\r\nA,A,C\r\nD,E,E");
  });

  it("places cells after a rowspan in the next free column", () => {
    const t = table(
      row("1", td("tall", { rowspan: 3 }), "3"),
      row("4", "6"),
      row("7", "9"),
      row("10", "11", "12"),
    );
    expect(csv(t)).toBe("1,tall,3\r\n4,,6\r\n7,,9\r\n10,11,12");
    expect(csv(t, { mergedCells: "repeat" })).toBe("1,tall,3\r\n4,tall,6\r\n7,tall,9\r\n10,11,12");
  });

  it("merges header cells too", () => {
    const t = table(row(th("Quý 1", { colspan: 3 })), row("T1", "T2", "T3"));
    expect(csv(t)).toBe("Quý 1,,\r\nT1,T2,T3");
    expect(csv(t, { mergedCells: "repeat" })).toBe("Quý 1,Quý 1,Quý 1\r\nT1,T2,T3");
  });

  it("clips rowspans past the last row and tolerates bad span attrs", () => {
    const t = table(
      row(td("x", { rowspan: 5 }), td("y", { colspan: 0 })),
      row({ type: "tableCell", attrs: { colspan: "2" }, content: [p("z")] }),
    );
    expect(csv(t)).toBe("x,y,\r\n,z,");
  });
});

describe("tableJsonToCsv — formula injection guard", () => {
  it("prefixes values starting with = + - @ tab or CR with an apostrophe by default", () => {
    const t = table(row("=SUM(A1:A2)", "+cmd", "-1+2", "@x", "\tx", "\rx"));
    expect(csv(t)).toBe(`'=SUM(A1:A2),'+cmd,'-1+2,'@x,'\tx,"'\rx"`);
  });

  it("leaves plain numbers alone", () => {
    const t = table(row("-12", "+84", "-3,5", "-10%", "-1 000.5"));
    expect(csv(t)).toBe('-12,+84,"-3,5",-10%,-1 000.5');
  });

  it("quotes an escaped value that still needs quoting", () => {
    expect(csv(table(row('=HYPERLINK("http://x","y")')))).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
  });

  it("can be turned off", () => {
    const t = table(row("=1+1", "@x"));
    expect(csv(t, { escapeFormulas: false })).toBe("=1+1,@x");
  });

  it("only looks at the first character", () => {
    expect(csv(table(row("a=b", "x-y")))).toBe("a=b,x-y");
  });
});

describe("tableNodeToCsv", () => {
  it("matches tableJsonToCsv for a ProseMirror node, including merged cells", () => {
    const json = table(
      row(th("Họ tên"), th("Ghi chú", { colspan: 2 })),
      row(
        td(p("Nguyễn ", { type: "mention", attrs: { id: "u1", label: "@An" } })),
        td(p("a", br, "b")),
        td({
          type: "bulletList",
          content: [{ type: "listItem", content: [p("x, y")] }],
        }),
      ),
    );
    const node = schema.nodeFromJSON(json);
    expect(node.type.name).toBe("table");
    expect(tableNodeToCsv(node)).toBe(tableJsonToCsv(json));
    expect(tableNodeToCsv(node, { bom: false })).toBe(
      'Họ tên,Ghi chú,\r\nNguyễn @An,"a\nb","x, y"',
    );
    expect(tableNodeToCsv(node, { bom: false, mergedCells: "repeat" })).toBe(
      'Họ tên,Ghi chú,Ghi chú\r\nNguyễn @An,"a\nb","x, y"',
    );
  });
});

describe("performance", () => {
  it("exports a 500×10 table quickly", () => {
    const rows = Array.from({ length: 500 }, (_, r) =>
      row(...Array.from({ length: 10 }, (_, c) => `Ô ${r}-${c}, "giá trị"`)),
    );
    const t = table(...rows);
    const start = performance.now();
    const out = tableJsonToCsv(t);
    const elapsed = performance.now() - start;
    expect(out.split("\r\n")).toHaveLength(500);
    expect(out.split("\r\n")[499]).toContain('"Ô 499-9, ""giá trị"""');
    expect(elapsed).toBeLessThan(500);
  });
});
