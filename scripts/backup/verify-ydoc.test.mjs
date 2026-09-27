import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DOCUMENT_FIELD, verifyAll, verifyLine } from "./verify-ydoc.mjs";

const require = createRequire(new URL("../../apps/collab/package.json", import.meta.url));
/** @type {typeof import("yjs")} */
const Y = require("yjs");
const SCRIPT = fileURLToPath(new URL("./verify-ydoc.mjs", import.meta.url));
const ID = "4f0c1c1e-3b7a-4c55-9d0e-1a2b3c4d5e6f";

/** @param {(doc: import("yjs").Doc) => void} [fill] */
const update = (fill) => {
  const doc = new Y.Doc();
  fill?.(doc);
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
};
const withParagraph = () =>
  update((doc) => {
    const p = new Y.XmlElement("paragraph");
    p.insert(0, [new Y.XmlText("Xin chào")]);
    doc.getXmlFragment(DOCUMENT_FIELD).insert(0, [p]);
  });

describe("verifyLine", () => {
  it("accepts a document with content and an empty one without text", () => {
    assert.deepEqual(verifyLine(`${ID}\t1\t${withParagraph()}`).ok, true);
    assert.equal(verifyLine(`${ID}\t1\t${withParagraph()}`).blocks, 1);
    assert.equal(verifyLine(`${ID}\t0\t${update()}`).ok, true);
  });

  it("rejects an empty document whose page has search text", () => {
    const r = verifyLine(`${ID}\t1\t${update()}`);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /empty document/);
  });

  it("rejects damaged or truncated updates", () => {
    const full = Buffer.from(withParagraph(), "base64");
    const truncated = full.subarray(0, full.length - 6).toString("base64");
    assert.equal(verifyLine(`${ID}\t1\t${truncated}`).ok, false);
    assert.equal(verifyLine(`${ID}\t1\t${Buffer.from("garbage!").toString("base64")}`).ok, false);
    assert.equal(verifyLine(`not-a-uuid\t0\t${update()}`).ok, false);
  });
});

describe("verify-ydoc.mjs (stdin)", () => {
  it("exits 0 with a summary when every document decodes", () => {
    const input = `${ID}\t1\t${withParagraph()}\n${ID}\t0\t${update()}\n`;
    assert.equal(verifyAll(input).checked, 2);
    const r = spawnSync(process.execPath, [SCRIPT], { input, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { checked: 2, failed: 0 });
  });

  it("exits 1 and names the failing page", () => {
    const r = spawnSync(process.execPath, [SCRIPT], {
      input: `${ID}\t1\t${update()}\n`,
      encoding: "utf8",
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(ID));
  });
});
