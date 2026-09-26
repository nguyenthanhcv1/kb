#!/usr/bin/env node
// Chèn ghi chú tiếng Việt changelog/vi/<version>.md vào section <version> của CHANGELOG.md
// (docs/PLAN.md §6.3). Chạy bởi .github/workflows/release-vi-notes.yml trên Release PR; idempotent.
//
//   node scripts/release/inject-vi-changelog.mjs [--version 0.3.0] [--check]
//
// --version  mặc định: version trong .release-please-manifest.json (Release PR đã bump nó).
// --check    chỉ kiểm tra file tiếng Việt tồn tại và không trống, không sửa CHANGELOG.md.
// Thoát: 0 = đã chèn/không đổi · 1 = thiếu/trống changelog/vi/<version>.md · 2 = lỗi khác.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { ChangelogError, injectViNotes } from "./changelog.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Version của package gốc trong manifest của release-please (null nếu chưa có file).
 * @param {string} root
 */
export function manifestVersion(root) {
  const file = path.join(root, ".release-please-manifest.json");
  if (!existsSync(file)) return null;
  const v = JSON.parse(readFileSync(file, "utf8"))["."];
  return typeof v === "string" ? v : null;
}

function main() {
  const { values } = parseArgs({
    options: {
      version: { type: "string" },
      changelog: { type: "string", default: "CHANGELOG.md" },
      "vi-dir": { type: "string", default: "changelog/vi" },
      check: { type: "boolean", default: false },
    },
  });
  const version = values.version || manifestVersion(ROOT);
  if (!version || !SEMVER.test(version)) {
    console.error(`::error::Không xác định được version (nhận: "${version ?? ""}").`);
    process.exit(2);
  }
  const viRel = path.posix.join(values["vi-dir"], `${version}.md`);
  const viFile = path.resolve(ROOT, viRel);
  if (!existsSync(viFile) || readFileSync(viFile, "utf8").trim() === "") {
    console.error(
      `::error file=${viRel}::Thiếu ghi chú phát hành tiếng Việt ${viRel}. ` +
        "Thêm file này (xem changelog/vi/README.md) rồi push lên nhánh Release PR.",
    );
    process.exit(1);
  }
  console.log(`Có ${viRel}.`);
  if (values.check) return;

  const changelogFile = path.resolve(ROOT, values.changelog);
  if (!existsSync(changelogFile)) {
    console.error(`::error::Không có ${values.changelog} — Release PR phải có file này.`);
    process.exit(2);
  }
  try {
    const { content, changed } = injectViNotes(
      readFileSync(changelogFile, "utf8"),
      version,
      readFileSync(viFile, "utf8"),
    );
    if (changed) writeFileSync(changelogFile, content);
    console.log(
      changed
        ? `Đã chèn khối "Tiếng Việt" vào ${values.changelog} (${version}).`
        : `${values.changelog} đã có khối "Tiếng Việt" mới nhất (${version}) — không đổi.`,
    );
  } catch (e) {
    if (e instanceof ChangelogError) {
      console.error(`::error::${e.message}`);
      process.exit(e.code === "VI_NOTES_EMPTY" ? 1 : 2);
    }
    throw e;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
