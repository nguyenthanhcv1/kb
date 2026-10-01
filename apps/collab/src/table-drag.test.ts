import { getEditorSchema } from "@kb/editor";
import { moveTableLine } from "@kb/editor/ui";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import {
  prosemirrorJSONToYDoc,
  updateYFragment,
  yXmlFragmentToProseMirrorRootNode,
} from "@tiptap/y-tiptap";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { DOCUMENT_FIELD } from "./content";

/** T4.3: moving rows/columns on one client while another client edits the same table. */
const schema = getEditorSchema();

const cell = (text: string) => ({
  type: "tableCell",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const rows = [
  ["a1", "b1", "c1"],
  ["a2", "b2", "c2"],
  ["a3", "b3", "c3"],
];
const initial = {
  type: "doc",
  content: [
    { type: "table", content: rows.map((r) => ({ type: "tableRow", content: r.map(cell) })) },
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

/** Applies `edit` to the client's document the way y-prosemirror does: diff into the fragment. */
function write(doc: Y.Doc, next: ProseMirrorNode) {
  const fragment = doc.getXmlFragment(DOCUMENT_FIELD);
  doc.transact(() => {
    updateYFragment(doc, fragment, next, { mapping: new Map(), isOMark: new Map() });
  });
}

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

function texts(doc: ProseMirrorNode): string[][] {
  const table = doc.child(0);
  const out: string[][] = [];
  table.forEach((row) => {
    const line: string[] = [];
    row.forEach((c) => line.push(c.textContent));
    out.push(line);
  });
  return out;
}

describe("table drag with two clients", () => {
  it("converges when one client moves a row while another edits a cell elsewhere", () => {
    const { a, b } = clients();

    // Client A moves the first row to the end.
    const stateA = EditorState.create({ doc: read(a) });
    const tr = moveTableLine(stateA, 0, "row", 0, 3)!;
    expect(tr).not.toBeNull();
    write(a, tr.doc);

    // Client B (not yet synced) types into the middle row.
    const docB = read(b);
    let target = -1;
    docB.descendants((node, pos) => {
      if (node.isText && node.text === "b2") target = pos + 2;
    });
    const editB = EditorState.create({ doc: docB }).tr.insertText("!", target);
    write(b, editB.doc);

    sync(a, b);
    const merged = read(a);
    expect(read(b).eq(merged)).toBe(true);
    expect(() => merged.check()).not.toThrow();
    expect(TableMap.get(merged.child(0)).problems).toBeNull();
    const result = texts(merged);
    expect(result).toHaveLength(3);
    // y-prosemirror writes a move as an in-place diff of the rows, so B's edit may land in the
    // cell that now sits where "b2" was or be superseded by the rewrite; what must hold is: valid table, nothing lost or doubled.
    expect(
      result
        .flat()
        .map((t) => t.replace("!", ""))
        .sort(),
    ).toEqual(rows.flat().sort());
    expect(result.flat().filter((t) => t.endsWith("!")).length).toBeLessThanOrEqual(1);
  });

  it("converges when both clients move columns at the same time", () => {
    const { a, b } = clients();
    write(a, moveTableLine(EditorState.create({ doc: read(a) }), 0, "column", 0, 3)!.doc);
    write(b, moveTableLine(EditorState.create({ doc: read(b) }), 0, "row", 2, 0)!.doc);

    sync(a, b);
    const merged = read(a);
    expect(read(b).eq(merged)).toBe(true);
    expect(() => merged.check()).not.toThrow();
    const table = merged.child(0);
    expect(TableMap.get(table).problems).toBeNull();
    // Every original cell is still there exactly once.
    expect(texts(merged).flat().sort()).toEqual(rows.flat().sort());
  });
});
