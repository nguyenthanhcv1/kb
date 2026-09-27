import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  sourcemap: true,
  // Workspace packages ship TypeScript sources: bundle them; npm dependencies stay external.
  noExternal: [/^@kb\//],
});
