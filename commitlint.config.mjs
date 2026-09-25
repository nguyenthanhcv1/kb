// Conventional Commits cho kb — xem AGENTS.md §2 và CONTRIBUTING.md.
// Dùng cho: hook commit-msg (lefthook) và kiểm tra tiêu đề PR trong CI (PR squash-merge → tiêu đề = commit).

/** Scope hợp lệ (AGENTS.md §2). Scope có thể bỏ trống, vd `docs: …`. */
export const scopes = [
  "web",
  "collab",
  "db",
  "editor",
  "table",
  "search",
  "auth",
  "i18n",
  "infra",
  "ci",
  "release",
  "docs",
  "deps",
];

/** Type chuẩn của config-conventional + `security` (mục "Security" trong changelog của release-please). */
export const types = [
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "revert",
  "security",
  "style",
  "test",
];

/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [2, "always", types],
    "scope-enum": [2, "always", scopes],
    // Tiêu đề gồm cả mã task `[T1.1]` và hậu tố squash ` (#123)`.
    "header-max-length": [2, "always", 100],
    // Nội dung PR (Handoff, checklist, link) được squash vào body — không giới hạn độ dài dòng.
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
