import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node by default: the schema must load on the server (kb-collab, search extraction)
    // without a DOM. Tests that need an editor view opt into happy-dom per file.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
