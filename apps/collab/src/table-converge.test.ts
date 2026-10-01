import { getEditorSchema } from "@kb/editor";
import { extractContent } from "@kb/editor/extract";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { addRowAfter, CellSelection, mergeCells, TableMap } from "@tiptap/pm/tables";
import {
  prosemirrorJSONToYDoc,
  updateYFragment,
  yXmlFragmentToProseMirrorRootNode,
} from "@tiptap/y-tiptap";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { DOCUMENT_FIELD, deriveContent } from "./content";

/** T4.6: two clients edit the same table at once; the result converges and stays searchable. */
const schema = getEditorSchema();

const cell = (text: string) => ({
  type: "tableCell",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const grid = [
  ["a1", "b1", "c1"],
  ["a2", "b2", "c2"],
  ["a3", "b3", "c3"],
];
const initial = {
  type: "doc",
  content: [
    { type: "table", content: grid.map((r) => ({ type: "tableRow", content: r.map(cell) })) },
    { type: "paragraph" },
  ],
};

function clients() {
  const a = prosemirrorJSONToYDoc(schema, initial, DOCUMENT_FIELD);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return { a, b };
}

const read = (doc: Y.Doc) =>
  yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(DOCUMENT_FIELD), schema);

function write(doc: Y.Doc, next: ProseMirrorNode) {
  doc.transact(() => {
    updateYFragment(doc, doc.getXmlFragment(DOCUMENT_FIELD), next, {
      mapping: new Map(),
      isOMark: new Map(),
    });
  });
}

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

function cellPos(doc: ProseMirrorNode, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (node.type.name === "tableCell" && node.textContent === text) found = pos;
  });
  expect(found).toBeGreaterThanOrEqual(0);
  return found;
}

/** Runs a table command against a client's current document and writes the result back. */
function apply(
  doc: Y.Doc,
  command: (
    state: EditorState,
    dispatch: (tr: ReturnType<EditorState["tr"]["setMeta"]>) => void,
  ) => boolean,
  selectionAt?: [string, string?],
) {
  const pm = read(doc);
  let state = EditorState.create({ doc: pm });
  if (selectionAt) {
    const from = cellPos(pm, selectionAt[0]);
    const to = cellPos(pm, selectionAt[1] ?? selectionAt[0]);
    state = state.apply(state.tr.setSelection(CellSelection.create(pm, from, to)));
  }
  let next: ProseMirrorNode | null = null;
  const ok = command(state, (tr) => {
    next = tr.doc;
  });
  expect(ok).toBe(true);
  write(doc, next!);
}

const cellTexts = (doc: ProseMirrorNode) => {
  const out: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      if (node.textContent) out.push(node.textContent);
      return false;
    }
    return true;
  });
  return out.sort();
};

function expectConverged(a: Y.Doc, b: Y.Doc) {
  sync(a, b);
  const merged = read(a);
  expect(read(b).eq(merged)).toBe(true);
  expect(() => merged.check()).not.toThrow();
  expect(TableMap.get(merged.child(0)).problems).toBeNull();
  return merged;
}

describe("table convergence with two clients", () => {
  it("adds a row on one client while another merges cells", () => {
    const { a, b } = clients();
    apply(a, addRowAfter, ["a3"]);
    apply(b, mergeCells, ["a1", "b2"]);

    const merged = expectConverged(a, b);
    // The added row is there and the merge happened; no text is lost.
    expect(merged.child(0).childCount).toBe(4);
    const map = TableMap.get(merged.child(0));
    expect(map.width).toBe(3);
    // The merged cell keeps the text of every cell it absorbed; the other cells are untouched.
    const texts = cellTexts(merged);
    for (const t of ["a3", "b3", "c3", "c1", "c2"]) expect(texts).toContain(t);
    expect(texts.join("")).toContain("a1");
    expect(texts.join("")).toContain("b2");
  });

  it("adds rows on both clients at the same time", () => {
    const { a, b } = clients();
    apply(a, addRowAfter, ["a1"]);
    apply(b, addRowAfter, ["a3"]);

    const merged = expectConverged(a, b);
    expect(merged.child(0).childCount).toBe(5);
    expect(cellTexts(merged)).toEqual(grid.flat().sort());
  });

  it("extracts the cell text of the converged table as table_text", () => {
    const { a, b } = clients();
    apply(a, addRowAfter, ["a3"]);
    apply(b, mergeCells, ["b1", "c1"]);
    expectConverged(a, b);

    const fromA = deriveContent(a);
    const fromB = deriveContent(b);
    expect(fromA.tableText).toBe(fromB.tableText);
    // Every surviving cell value is searchable through table_text and kept out of the body text.
    for (const text of ["a1", "a2", "b2", "c2", "a3", "b3", "c3"]) {
      expect(fromA.tableText).toContain(text);
    }
    expect(fromA.contentText).not.toContain("a1");
    expect(extractContent(fromA.contentJson).tableText).toBe(fromA.tableText);
  });
});
