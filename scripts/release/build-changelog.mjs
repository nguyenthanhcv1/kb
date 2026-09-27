#!/usr/bin/env node
// Sinh apps/web/src/generated/changelog.json cho trang What's new (docs/PLAN.md §6.3) từ
// CHANGELOG.md (phần tiếng Anh) + changelog/vi/<version>.md. File sinh ra không commit (.gitignore).
// Chạy tự động trước `build`/`dev` của @kb/web (turbo.json: task `//#changelog:build`).
//
//   node scripts/release/build-changelog.mjs [--changelog CHANGELOG.md] [--vi-dir changelog/vi] [--out …]
//
// Chưa có CHANGELOG.md (trước release đầu tiên) → ghi `[]`.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { buildEntries, versionFromViFile } from "./changelog.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Đọc mọi `changelog/vi/<version>.md` (bỏ README, mẫu…).
 * @param {string} dir
 * @returns {Map<string, string>}
 */
export function readViNotes(dir) {
  /** @type {Map<string, string>} */
  const notes = new Map();
  if (!existsSync(dir)) return notes;
  for (const name of readdirSync(dir)) {
    const version = versionFromViFile(name);
    if (version) notes.set(version, readFileSync(path.join(dir, name), "utf8"));
  }
  return notes;
}

function main() {
  const { values } = parseArgs({
    options: {
      changelog: { type: "string", default: "CHANGELOG.md" },
      "vi-dir": { type: "string", default: "changelog/vi" },
      out: { type: "string", default: "apps/web/src/generated/changelog.json" },
    },
  });
  const changelogFile = path.resolve(ROOT, values.changelog);
  const changelog = existsSync(changelogFile) ? readFileSync(changelogFile, "utf8") : "";
  const entries = buildEntries(changelog, readViNotes(path.resolve(ROOT, values["vi-dir"])));
  const out = path.resolve(ROOT, values.out);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(entries, null, 2)}\n`);
  const missingVi = entries.filter((e) => e.vi === null).map((e) => e.version);
  console.log(
    `${path.relative(ROOT, out)}: ${entries.length} version` +
      (missingVi.length ? ` (thiếu tiếng Việt: ${missingVi.join(", ")})` : ""),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
