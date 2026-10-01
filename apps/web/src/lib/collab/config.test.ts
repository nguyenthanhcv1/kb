import { EDITOR_SCHEMA_VERSION } from "@kb/editor/schema-version";
import { describe, expect, it } from "vitest";

import { collabClientConfig } from "./config";

describe("collabClientConfig", () => {
  it("is null when collab is not configured", () => {
    expect(collabClientConfig({})).toBeNull();
    expect(collabClientConfig({ COLLAB_PUBLIC_URL: " " })).toBeNull();
  });
  it("hands the URL and schema version to the client", () => {
    expect(collabClientConfig({ COLLAB_PUBLIC_URL: "wss://collab.example.com/" })).toEqual({
      url: "wss://collab.example.com",
      schemaVersion: EDITOR_SCHEMA_VERSION,
    });
  });
});
