import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

import { noLiteralString } from "./i18n.js";

export const ignores = {
  ignores: ["**/dist/**", "**/.next/**", "**/coverage/**", "**/.turbo/**", "**/*.gen.ts"],
};

/** Repo-wide rules; appended last so presets (e.g. Next) cannot downgrade them. */
export const rules = {
  rules: {
    "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
  },
};

/** Shared flat config for every TypeScript package in the monorepo. */
export default tseslint.config(
  ignores,
  js.configs.recommended,
  ...tseslint.configs.recommended,
  rules,
  ...noLiteralString,
  prettier,
);
