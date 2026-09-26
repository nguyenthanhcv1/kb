import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findViolations, isExpressionAllowed } from "./check.mjs";

const allowed = new Set(["MIT", "Apache-2.0", "ISC"]);
const isAllowed = (/** @type {string} */ id) => allowed.has(id);

describe("isExpressionAllowed", () => {
  it("accepts a single allowed id", () => {
    assert.equal(isExpressionAllowed("MIT", isAllowed), true);
  });

  it("rejects a single disallowed id", () => {
    assert.equal(isExpressionAllowed("GPL-3.0-only", isAllowed), false);
  });

  it("OR needs one allowed side", () => {
    assert.equal(isExpressionAllowed("(MIT OR GPL-3.0-only)", isAllowed), true);
    assert.equal(isExpressionAllowed("GPL-2.0 OR AGPL-3.0", isAllowed), false);
  });

  it("AND needs every side allowed", () => {
    assert.equal(isExpressionAllowed("Apache-2.0 AND MIT", isAllowed), true);
    assert.equal(isExpressionAllowed("MIT AND GPL-3.0-only", isAllowed), false);
  });

  it("respects parentheses", () => {
    assert.equal(isExpressionAllowed("ISC AND (MIT OR GPL-3.0-only)", isAllowed), true);
    assert.equal(isExpressionAllowed("(ISC AND GPL-3.0-only) OR LGPL-2.1", isAllowed), false);
  });

  it("keeps WITH exceptions attached to their license", () => {
    assert.equal(isExpressionAllowed("GPL-2.0 WITH Classpath-exception-2.0", isAllowed), false);
  });

  it("rejects malformed or unknown expressions", () => {
    assert.equal(isExpressionAllowed("(MIT", isAllowed), false);
    assert.equal(isExpressionAllowed("MIT OR", isAllowed), false);
    assert.equal(isExpressionAllowed("Unknown", isAllowed), false);
  });
});

describe("findViolations", () => {
  const policy = {
    allowed: ["MIT"],
    exceptions: {
      "@img/sharp-libvips-*": { license: "LGPL-3.0-or-later", reason: "test" },
      "caniuse-lite": { license: "CC-BY-4.0", reason: "test" },
    },
  };

  it("reports disallowed packages and honours name-scoped exceptions", () => {
    const report = {
      MIT: [{ name: "react", versions: ["19.0.0"] }],
      "LGPL-3.0-or-later": [
        { name: "@img/sharp-libvips-linux-x64", versions: ["1.2.0"] },
        { name: "some-lgpl-lib", versions: ["2.0.0"] },
      ],
      "CC-BY-4.0": [{ name: "caniuse-lite", versions: ["1.0.1"] }],
      "GPL-3.0-only": [{ name: "gpl-thing", versions: ["0.1.0"] }],
    };
    assert.deepEqual(findViolations(report, policy), [
      { name: "gpl-thing", versions: ["0.1.0"], license: "GPL-3.0-only" },
      { name: "some-lgpl-lib", versions: ["2.0.0"], license: "LGPL-3.0-or-later" },
    ]);
  });

  it("does not let an exception cover a different license", () => {
    const report = { "GPL-3.0-only": [{ name: "caniuse-lite", versions: ["9.9.9"] }] };
    assert.equal(findViolations(report, policy).length, 1);
  });
});
