import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.join(import.meta.dirname, "src") },
  },
  // Component tests (*.test.tsx): React 19 automatic JSX runtime (tsconfig keeps `preserve` for Next).
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    // Node by default; component tests opt into happy-dom with `// @vitest-environment happy-dom`.
    environment: "node",
    setupFiles: ["./test/setup-dom.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "test/**/*.test.ts"],
  },
});
