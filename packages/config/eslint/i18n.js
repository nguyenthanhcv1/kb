import i18next from "eslint-plugin-i18next";

/** Attributes whose text reaches the user (screen or assistive technology). */
const TEXT_ATTRIBUTES = [
  "alt",
  "aria-description",
  "aria-label",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "label",
  "placeholder",
  "title",
];

const attr = `JSXAttribute[name.name=/^(${TEXT_ATTRIBUTES.join("|")})$/]`;
// Only strings containing letters (Latin + Vietnamese); "", "·", "42" stay allowed.
const hasLetters = "[value=/[A-Za-z\\u00C0-\\u1EF9]/]";
const templateHasLetters = "[value.raw=/[A-Za-z\\u00C0-\\u1EF9]/]";
const message =
  "User-visible text must come from next-intl (t('namespace.key')). See AGENTS.md §1. " +
  "Exceptions need an eslint-disable comment with a reason.";

/**
 * Bans hard-coded user-visible strings in JSX (docs/PLAN.md §5.4):
 * - `i18next/no-literal-string` (mode `jsx-text-only`): text between tags;
 * - `no-restricted-syntax`: string literals in text attributes and `{"..."}` children.
 * Tests, stories and E2E specs are exempt.
 */
export const noLiteralString = [
  {
    name: "kb/i18n-no-literal-string",
    files: ["**/*.jsx", "**/*.tsx"],
    ignores: ["**/*.test.tsx", "**/*.spec.tsx", "**/*.stories.tsx", "**/e2e/**", "**/test/**"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-text-only",
          message,
          // Text without any letter (numbers, "·", "→", "&nbsp;"), CONSTANT_CASE and emoji.
          words: { exclude: [/^[^\p{L}]*$/u, "[A-Z_-]+", /^\p{Emoji}+$/u] },
        },
      ],
      "no-restricted-syntax": [
        "error",
        ...[
          `${attr} > Literal${hasLetters}`,
          `${attr} > JSXExpressionContainer > Literal${hasLetters}`,
          `${attr} > JSXExpressionContainer > ConditionalExpression > Literal${hasLetters}`,
          `${attr} > JSXExpressionContainer > LogicalExpression > Literal${hasLetters}`,
          `${attr} > JSXExpressionContainer > TemplateLiteral > TemplateElement${templateHasLetters}`,
          `:matches(JSXElement, JSXFragment) > JSXExpressionContainer > Literal${hasLetters}`,
          `:matches(JSXElement, JSXFragment) > JSXExpressionContainer > TemplateLiteral > TemplateElement${templateHasLetters}`,
        ].map((selector) => ({ selector, message })),
      ],
    },
  },
];
