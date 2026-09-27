import { readFileSync } from "node:fs";

import type { JSONContent } from "@tiptap/core";
import { Schema } from "@tiptap/pm/model";
import { TableMap } from "@tiptap/pm/tables";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

import { getEditorSchema } from "../src/extensions";
import {
  type HtmlParser,
  type PastedTable,
  normalizeColor,
  parseClipboardTable,
  parseHtmlTable,
  parseTsv,
  pastedTableToJSON,
  pastedTableToNode,
  planTablePaste,
} from "../src/table/paste";

const window = new Window();
const domParser = new window.DOMParser();
const parseHtml = ((html: string) =>
  domParser.parseFromString(html, "text/html")) as unknown as HtmlParser;

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/clipboard/${name}`, import.meta.url), "utf8");

const html = (name: string) => {
  const table = parseHtmlTable(fixture(`${name}.text-html.txt`), { parseHtml });
  if (!table) throw new Error(`no table in ${name}`);
  return table;
};

/** Text at every grid slot: the cell's text at its top-left corner, "" in covered slots. */
const textGrid = (table: PastedTable) => {
  const grid = Array.from({ length: table.rowCount }, () =>
    Array.from({ length: table.colCount }, () => ""),
  );
  for (const cell of table.rows.flat()) grid[cell.row]![cell.col] = cell.text.trim();
  return grid;
};

const cellAt = (table: PastedTable, row: number, col: number) => {
  const cell = table.rows[row]?.find((c) => c.col === col);
  if (!cell) throw new Error(`no cell anchored at ${row},${col}`);
  return cell;
};

/** Every cell's text is NFC, whatever the fixture held. */
const expectNfc = (table: PastedTable) => {
  for (const cell of table.rows.flat()) expect(cell.text).toBe(cell.text.normalize("NFC"));
};

/** Editor schema + TipTap table nodes (what T4.1/T4.2 will add), for node conversion tests. */
function tableSchema({ background = true, hardBreak = true } = {}): Schema {
  const base = getEditorSchema();
  const cellAttrs = {
    colspan: { default: 1 },
    rowspan: { default: 1 },
    colwidth: { default: null },
    ...(background ? { backgroundColor: { default: null } } : {}),
  };
  let nodes = base.spec.nodes.append({
    table: { group: "block", content: "tableRow+", tableRole: "table", isolating: true },
    tableRow: { content: "(tableCell | tableHeader)*", tableRole: "row" },
    tableCell: { content: "block+", attrs: cellAttrs, tableRole: "cell", isolating: true },
    tableHeader: { content: "block+", attrs: cellAttrs, tableRole: "header_cell", isolating: true },
  });
  if (!hardBreak) nodes = nodes.remove("hardBreak");
  return new Schema({ nodes, marks: base.spec.marks });
}

describe("parseHtmlTable — Excel for Windows", () => {
  const table = html("excel-windows");

  it("reads the grid, spans and text", () => {
    expect(table.source).toBe("excel");
    expect(table.rowCount).toBe(5);
    expect(table.colCount).toBe(3);
    expect(textGrid(table)).toEqual([
      ["Báo cáo doanh thu quý 3", "", ""],
      ["Khu vực", "Doanh thu (VNĐ)", "Ghi chú"],
      ["Hà Nội", "1,234,567.00", "Tăng trưởng tốt\n(so với quý 2)"],
      ["", "987,654.50", ""],
      ["Thành phố Hồ Chí Minh", "2,500,000.00", "Đạt 120% kế hoạch"],
    ]);
    expect(cellAt(table, 0, 0)).toMatchObject({ colspan: 3, rowspan: 1 });
    expect(cellAt(table, 2, 0)).toMatchObject({ colspan: 1, rowspan: 2 });
    expect(table.rows[3]!.map((c) => c.col)).toEqual([1, 2]);
    expectNfc(table);
  });

  it("maps class-based and inline backgrounds, dropping white", () => {
    expect(cellAt(table, 0, 0).background).toBe("#ffff00");
    expect(table.rows[1]!.map((c) => c.background)).toEqual(["#c6efce", "#c6efce", "#c6efce"]);
    expect(cellAt(table, 3, 2).background).toBeNull(); // .xl71 {background:white}
    expect(cellAt(table, 4, 2).background).toBe("#ffc7ce"); // inline style wins
    expect(cellAt(table, 2, 1).background).toBeNull();
  });

  it("skips the hidden width row but uses its widths", () => {
    expect(table.columnWidths).toEqual([128, 128, 128]);
  });
});

describe("parseHtmlTable — Excel for Mac", () => {
  const table = html("excel-mac");

  it("reads spans, backgrounds and widths", () => {
    expect(table.source).toBe("excel");
    expect(textGrid(table)).toEqual([
      ["Họ và tên", "Phòng ban", "Tỷ lệ"],
      ["Nguyễn Văn Ấn", "Kỹ thuật", "85%"],
      ["Trần Thị Bích Ngọc", "", "100%"],
      ["Lê Hoàng Yến", "", "-3,5"],
    ]);
    expect(cellAt(table, 1, 1)).toMatchObject({ rowspan: 2, background: "#ffc000" });
    expect(table.rows[0]!.every((c) => c.background === "#ddebf7")).toBe(true);
    expect(cellAt(table, 3, 1)).toMatchObject({ text: "", background: null });
    expect(table.columnWidths).toEqual([87, 86, 86]);
    expectNfc(table);
  });
});

describe("parseHtmlTable — Google Sheets", () => {
  const table = html("google-sheets");

  it("reads the grid through <google-sheets-html-origin>", () => {
    expect(table.source).toBe("google-sheets");
    expect(textGrid(table)).toEqual([
      ["Sản phẩm", "Số lượng", "Đơn giá", "Ghi chú"],
      ["Cà phê sữa đá", "120", "25,000", "Bán chạy\nnhất tuần"],
      ["Trà đào cam sả", "85", "30,000", ""],
      ["Tổng cộng", "", "5,550,000", ""],
    ]);
    expect(cellAt(table, 1, 3)).toMatchObject({ rowspan: 2, background: "#b7e1cd" });
    expect(cellAt(table, 3, 0)).toMatchObject({ colspan: 2, background: "#fce5cd" });
    expect(cellAt(table, 3, 2).background).toBeNull(); // #ffffff = no fill
    expect(cellAt(table, 0, 0).background).toBe("#4a86e8");
    expect(table.columnWidths).toEqual([120, 100, 100, 160]);
    expectNfc(table);
  });
});

describe("parseHtmlTable — LibreOffice Calc", () => {
  const table = html("libreoffice");

  it("reads bgcolor, colgroup widths and a 2×2 merge", () => {
    expect(table.source).toBe("libreoffice");
    expect(textGrid(table)).toEqual([
      ["Mã đơn", "Trạng thái", "Phí ship"],
      ["GHN-001", "Đang giao\nchờ xác nhận", ""],
      ["GHN-002", "", ""],
      ["GHN-003", "Giao thành công", "32,500"],
      ["", "", "0"],
    ]);
    expect(cellAt(table, 1, 1)).toMatchObject({ colspan: 2, rowspan: 2, background: "#ffd7d7" });
    expect(cellAt(table, 0, 2).background).toBe("#ffff00");
    expect(table.rows[2]).toHaveLength(1);
    expect(table.columnWidths).toEqual([140, 85, 85]);
    expectNfc(table);
  });
});

describe("parseTsv — text/plain fallback", () => {
  it.each(["excel-windows", "google-sheets", "libreoffice"])(
    "%s text/plain matches the HTML grid",
    (name) => {
      const tsv = parseTsv(fixture(`${name}.text-plain.txt`));
      expect(tsv?.source).toBe("tsv");
      expect(textGrid(tsv!)).toEqual(textGrid(html(name)));
      expectNfc(tsv!);
    },
  );

  it("unquotes Excel fields with tabs, newlines and doubled quotes", () => {
    const table = parseTsv('a\t"b\tc"\t"say ""hi"""\r\n"line 1\r\nline 2"\t\tlast\r\n')!;
    expect(textGrid(table)).toEqual([
      ["a", "b\tc", 'say "hi"'],
      ["line 1\nline 2", "", "last"],
    ]);
  });

  it("keeps quotes that do not wrap a whole field", () => {
    const table = parseTsv('5" screen\t"quoted" tail\t"open\nx\ty')!;
    expect(table.rows[0]!.map((c) => c.text)).toEqual(['5" screen', '"quoted" tail', '"open']);
    expect(table.rows[1]!.map((c) => c.text)).toEqual(["x", "y", ""]);
  });

  it("handles CR-only rows, BOM, ragged rows and trailing tabs", () => {
    const table = parseTsv("\uFEFFa\tb\rc\rd\te\tf\t\r")!;
    expect(table.colCount).toBe(4);
    expect(textGrid(table)).toEqual([
      ["a", "b", "", ""],
      ["c", "", "", ""],
      ["d", "e", "f", ""],
    ]);
  });

  it("normalises decomposed Vietnamese to NFC", () => {
    const table = parseTsv("Tiếng Việt\tđầy đủ dấu".normalize("NFD"))!;
    expect(table.rows[0]!.map((c) => c.text)).toEqual(["Tiếng Việt", "đầy đủ dấu"]);
  });

  it("returns null for blank text", () => {
    expect(parseTsv("")).toBeNull();
    expect(parseTsv(" \r\n")).toBeNull();
  });
});

describe("parseClipboardTable", () => {
  it("prefers text/html when it holds a table", () => {
    const table = parseClipboardTable(
      {
        html: fixture("google-sheets.text-html.txt"),
        text: fixture("google-sheets.text-plain.txt"),
      },
      { parseHtml },
    );
    expect(table?.source).toBe("google-sheets");
  });

  it("falls back to TSV when the HTML has no table (single Sheets cell)", () => {
    const table = parseClipboardTable(
      {
        html: '<meta charset="utf-8"><google-sheets-html-origin><span>x</span></google-sheets-html-origin>',
        text: "x\ty",
      },
      { parseHtml },
    );
    expect(table?.source).toBe("tsv");
  });

  it("returns null when nothing looks like a table", () => {
    expect(parseClipboardTable({ html: "<p>hello</p>", text: "hello\nworld" })).toBeNull();
    expect(parseClipboardTable({})).toBeNull();
  });

  it("strips a raw Windows CF_HTML header", () => {
    const cf = `Version:0.9\r\nStartHTML:0000000105\r\nEndHTML:0000000200\r\n<html><body><table><tr><td>a</td><td>b</td></tr></table></body></html>`;
    expect(textGrid(parseClipboardTable({ html: cf }, { parseHtml })!)).toEqual([["a", "b"]]);
  });

  it("asks for a parser outside the browser", () => {
    expect(() => parseHtmlTable("<table><tr><td>a</td></tr></table>")).toThrow(
      /KB_PASTE_NO_HTML_PARSER/,
    );
  });
});

describe("parseHtmlTable — malformed markup", () => {
  it("keeps the grid rectangular with overlapping and oversized spans", () => {
    const table = parseHtmlTable(
      `<table>
        <thead><tr><th>A</th><th colspan="2">B</th></tr></thead>
        <tbody>
          <tr><td rowspan="9">x</td><td>y</td></tr>
          <tr><td colspan="0">z</td><td>w</td><td>extra</td></tr>
          <tr></tr>
        </tbody>
      </table>`,
      { parseHtml },
    )!;
    expect(table.source).toBe("html");
    expect(table.rowCount).toBe(4);
    expect(table.colCount).toBe(4);
    expect(cellAt(table, 0, 0).header).toBe(true);
    expect(cellAt(table, 1, 0).rowspan).toBe(3); // clamped to the last row
    expect(textGrid(table)).toEqual([
      ["A", "B", "", ""],
      ["x", "y", "", ""],
      ["", "z", "w", "extra"],
      ["", "", "", ""],
    ]);
    const node = pastedTableToNode(table, tableSchema())!;
    expect(TableMap.get(node).problems).toBeFalsy();
  });

  it("ignores nested tables' rows and style/script content", () => {
    const table = parseHtmlTable(
      "<table><tr><td>a<style>.x{}</style><table><tr><td>in</td></tr></table></td><td>b</td></tr></table>",
      { parseHtml },
    )!;
    expect(textGrid(table)).toEqual([["a\nin", "b"]]);
  });
});

describe("normalizeColor", () => {
  it.each([
    ["#FFFF00", "#ffff00"],
    ["#fc0", "#ffcc00"],
    ["#ff000080", "#ff0000"],
    ["#ff000000", null],
    ["rgb(183, 225, 205)", "#b7e1cd"],
    ["rgba(0,0,0,0)", null],
    ["rgb(100% 0% 0%)", "#ff0000"],
    ["Yellow", "#ffff00"],
    ["white", null],
    ["#FFF", null],
    ["transparent", null],
    ["windowtext", null],
    ["#c6efce !important", "#c6efce"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeColor(input)).toBe(expected);
  });
});

describe("pastedTableToJSON", () => {
  const table = html("google-sheets");

  it("builds TipTap table JSON with spans, widths and hard breaks", () => {
    const json = pastedTableToJSON(table);
    expect(json.type).toBe("table");
    expect(json.content).toHaveLength(4);
    const [first] = json.content![0]!.content!;
    expect(first).toEqual({
      type: "tableCell",
      attrs: { colspan: 1, rowspan: 1, colwidth: [120] },
      content: [{ type: "paragraph", content: [{ type: "text", text: "Sản phẩm" }] }],
    });
    const note = json.content![1]!.content![3]!;
    expect(note.attrs).toEqual({ colspan: 1, rowspan: 2, colwidth: [160] });
    expect(note.content).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Bán chạy" },
          { type: "hardBreak" },
          { type: "text", text: "nhất tuần" },
        ],
      },
    ]);
    const total = json.content![3]!.content![0]!;
    expect(total.attrs).toEqual({ colspan: 2, rowspan: 1, colwidth: [120, 100] });
    expect(json.content![3]!.content![2]!.content).toEqual([{ type: "paragraph" }]);
  });

  it("plugs in a background attribute, palette mapping, header row and paragraphs", () => {
    const json = pastedTableToJSON(table, {
      backgroundAttr: "backgroundColor",
      mapBackground: (hex) => (hex === "#4a86e8" ? "blue" : null),
      headerRow: true,
      columnWidths: false,
      lineBreaks: "paragraphs",
    });
    const header = json.content![0]!.content![0]!;
    expect(header).toMatchObject({
      type: "tableHeader",
      attrs: { colspan: 1, rowspan: 1, backgroundColor: "blue" },
    });
    expect(header.attrs).not.toHaveProperty("colwidth");
    const note = json.content![1]!.content![3]! as JSONContent;
    expect(note.type).toBe("tableCell");
    expect(note.attrs).not.toHaveProperty("backgroundColor"); // mapped to null
    expect(note.content).toHaveLength(2);
  });
});

describe("pastedTableToNode", () => {
  it("returns null until the shared schema has table nodes", () => {
    const schema = getEditorSchema();
    if (schema.nodes.table) return; // T4.1 landed: covered by the tests below
    expect(pastedTableToNode(html("excel-windows"), schema)).toBeNull();
  });

  it.each(["excel-windows", "excel-mac", "google-sheets", "libreoffice"])(
    "%s → a valid ProseMirror table",
    (name) => {
      const table = html(name);
      const node = pastedTableToNode(table, tableSchema())!;
      node.check();
      const map = TableMap.get(node);
      expect(map.problems).toBeFalsy();
      expect(map.width).toBe(table.colCount);
      expect(map.height).toBe(table.rowCount);
    },
  );

  it("emits backgrounds only when the schema defines the attribute", () => {
    const table = html("excel-windows");
    const withBg = pastedTableToNode(table, tableSchema())!;
    expect(withBg.firstChild!.firstChild!.attrs.backgroundColor).toBe("#ffff00");
    expect(withBg.firstChild!.firstChild!.attrs.colwidth).toEqual([128, 128, 128]);

    const withoutBg = pastedTableToNode(table, tableSchema({ background: false }))!;
    expect(withoutBg.firstChild!.firstChild!.attrs).toEqual({
      colspan: 3,
      rowspan: 1,
      colwidth: [128, 128, 128],
    });
  });

  it("uses paragraphs for line breaks when the schema has no hardBreak", () => {
    const node = pastedTableToNode(html("libreoffice"), tableSchema({ hardBreak: false }))!;
    const merged = node.child(1).child(1);
    expect(merged.childCount).toBe(2);
    expect(merged.textContent).toBe("Đang giaochờ xác nhận");
  });
});

describe("planTablePaste", () => {
  const pasted = parseTsv("a\tb\tc\nd\te\tf")!; // 2 × 3

  it("overwrites in place when the table is big enough", () => {
    const plan = planTablePaste({ rowCount: 5, colCount: 5 }, { row: 1, col: 1 }, pasted);
    expect(plan).toMatchObject({
      addRows: 0,
      addCols: 0,
      rowCount: 5,
      colCount: 5,
      region: { top: 1, left: 1, bottom: 3, right: 4 },
      cellsToSplit: [],
    });
    expect(plan.writes.map((w) => [w.targetRow, w.targetCol, w.text])).toEqual([
      [1, 1, "a"],
      [1, 2, "b"],
      [1, 3, "c"],
      [2, 1, "d"],
      [2, 2, "e"],
      [2, 3, "f"],
    ]);
  });

  it("reports the rows and columns to append", () => {
    const plan = planTablePaste({ rowCount: 2, colCount: 3 }, { row: 1, col: 2 }, pasted);
    expect(plan).toMatchObject({ addRows: 1, addCols: 2, rowCount: 3, colCount: 5 });
    expect(plan.region).toEqual({ top: 1, left: 2, bottom: 3, right: 5 });
  });

  it("lists existing merged cells touching the region", () => {
    const plan = planTablePaste(
      {
        rowCount: 4,
        colCount: 4,
        cells: [
          { row: 0, col: 0, rowspan: 2, colspan: 2 }, // overlaps the corner
          { row: 3, col: 0, rowspan: 1, colspan: 4 }, // below the region
          { row: 1, col: 3, rowspan: 1, colspan: 1 }, // not merged
        ],
      },
      { row: 1, col: 1 },
      pasted,
    );
    expect(plan.cellsToSplit).toEqual([{ row: 0, col: 0, rowspan: 2, colspan: 2 }]);
  });

  it("keeps pasted spans on the writes", () => {
    const plan = planTablePaste(
      { rowCount: 1, colCount: 1 },
      { row: 0, col: 0 },
      html("libreoffice"),
    );
    expect(plan).toMatchObject({ addRows: 4, addCols: 2 });
    expect(plan.writes.find((w) => w.rowspan === 2)).toMatchObject({
      targetRow: 1,
      targetCol: 1,
      colspan: 2,
    });
  });
});

describe("performance", () => {
  const ROWS = 500;
  const COLS = 10;
  const BUDGET_MS = 1000;
  const value = (r: number, c: number) => `Dòng ${r} cột ${c} – ${"giá trị ".repeat(3)}`;

  /**
   * Best of 3 runs: the first run pays JIT warm-up and a loaded CI machine adds noise; the
   * budget is about the parser, not the runner. happy-dom's HTML tokenizer is several times
   * slower than a browser's native `DOMParser`, so the browser has more headroom.
   */
  const bestOf3 = <T>(run: () => T): { result: T; ms: number } => {
    let best = Number.POSITIVE_INFINITY;
    let result!: T;
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      result = run();
      best = Math.min(best, performance.now() - start);
    }
    return { result, ms: best };
  };

  it(`parses a ${ROWS}-row Excel HTML paste into a table node in < 1 s`, () => {
    const rows = Array.from(
      { length: ROWS },
      (_, r) =>
        ` <tr height=20 style='height:15.0pt'>\n` +
        Array.from(
          { length: COLS },
          (_, c) =>
            `  <td class=xl6${c % 3} style='border-top:none'${r % 50 === 0 && c === 0 ? " colspan=2" : ""}>${value(r, c)}</td>\n`,
        )
          .slice(0, r % 50 === 0 ? COLS - 1 : COLS)
          .join("") +
        " </tr>\n",
    ).join("");
    const payload = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><style><!--.xl60{background:#FFFF00;} .xl61{background:#C6EFCE;}--></style></head><body><table>${rows}</table></body></html>`;
    const schema = tableSchema();

    const { result, ms } = bestOf3(() => {
      const table = parseClipboardTable({ html: payload }, { parseHtml })!;
      return { table, node: pastedTableToNode(table, schema)! };
    });

    expect(result.table.rowCount).toBe(ROWS);
    expect(result.table.colCount).toBe(COLS);
    expect(result.node.childCount).toBe(ROWS);
    expect(result.node.child(0).child(0).attrs.backgroundColor).toBe("#ffff00");
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it(`parses a ${ROWS}-row TSV paste into a table node in < 1 s`, () => {
    const text = Array.from({ length: ROWS }, (_, r) =>
      Array.from({ length: COLS }, (_, c) => (c === 3 ? `"${value(r, c)}\n2"` : value(r, c))).join(
        "\t",
      ),
    ).join("\r\n");
    const schema = tableSchema();

    const { result, ms } = bestOf3(() => {
      const table = parseTsv(text)!;
      return { table, node: pastedTableToNode(table, schema)! };
    });

    expect(result.table.rowCount).toBe(ROWS);
    expect(result.table.colCount).toBe(COLS);
    expect(result.node.childCount).toBe(ROWS);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});
