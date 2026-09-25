import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

import { ignores, rules } from "./base.js";
import { noLiteralString } from "./i18n.js";

/** Flat config for the Next.js app (apps/web). eslint-config-next already registers typescript-eslint. */
export default [
  ignores,
  js.configs.recommended,
  ...nextVitals,
  ...nextTs,
  rules,
  ...noLiteralString,
  prettier,
];
