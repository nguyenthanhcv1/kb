import { describe, expect, it } from "vitest";

import { parseDocumentReplaced } from "./replaced";

describe("parseDocumentReplaced", () => {
  it("reads the message kb-collab sends after a restore", () => {
    expect(
      parseDocumentReplaced('{"type":"document.replaced","reason":"restore","actorId":"u1"}'),
    ).toEqual({ reason: "restore", actorId: "u1" });
  });

  it("accepts template and import, and a missing actor", () => {
    expect(parseDocumentReplaced('{"type":"document.replaced","reason":"template"}')).toEqual({
      reason: "template",
      actorId: null,
    });
    expect(parseDocumentReplaced('{"type":"document.replaced","reason":"import"}')?.reason).toBe(
      "import",
    );
  });

  it("ignores other messages, unknown reasons and malformed payloads", () => {
    expect(parseDocumentReplaced('{"type":"something.else","reason":"restore"}')).toBeNull();
    expect(parseDocumentReplaced('{"type":"document.replaced","reason":"nope"}')).toBeNull();
    expect(parseDocumentReplaced("not json")).toBeNull();
    expect(parseDocumentReplaced("null")).toBeNull();
  });
});
