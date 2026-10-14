#!/usr/bin/env node
// Chèn ghi chú tiếng Việt của <version> vào section <version> của CHANGELOG.md (docs/PLAN.md §6.3).
// Chạy bởi .github/workflows/release-vi-notes.yml trên Release PR; idempotent.
//
//   node scripts/release/inject-vi-changelog.mjs [--version 0.3.0] [--check]
//
// Nguồn ghi chú (changelog/vi/README.md):
//   - changelog/vi/<version>.md viết tay (vd bản tổng quan) — có thì dùng nguyên file này;
//   - không có → gộp changelog/vi/unreleased/*.md (mỗi PR feat/fix một file) thành <version>.md.
//   Sau khi chèn, các file unreleased/ bị xoá: chúng đã thuộc về <version>. Workflow commit cả hai.
// --version  mặc định: version trong .release-please-manifest.json (Release PR đã bump nó).
// --check    chỉ kiểm tra có ghi chú (file <version>.md hoặc unreleased/), không sửa file nào.
// Thoát: 0 = đã chèn/không đổi · 1 = không có ghi chú tiếng Việt nào · 2 = lỗi khác.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  ChangelogError,
  UNRELEASED_DIR,
  injectViNotes,
  isViFragmentFile,
  mergeViFragments,
} from "./changelog.mjs";

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

/**
 * Ghi chú chờ phát hành trong `dir` (bỏ file trống).
 * @param {string} dir
 * @returns {{ name: string, file: string, content: string }[]}
 */
export function readViFragments(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(isViFragmentFile)
    .sort()
    .map((name) => ({ name, file: path.join(dir, name) }))
    .map((f) => ({ ...f, content: readFileSync(f.file, "utf8") }))
    .filter((f) => f.content.trim() !== "");
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
  const fragmentRel = path.posix.join(values["vi-dir"], UNRELEASED_DIR);
  const fragments = readViFragments(path.resolve(ROOT, fragmentRel));
  const hasViFile = existsSync(viFile) && readFileSync(viFile, "utf8").trim() !== "";
  if (!hasViFile && fragments.length === 0) {
    console.error(
      `::error file=${viRel}::Thiếu ghi chú phát hành tiếng Việt: không có ${viRel} và ` +
        `${fragmentRel}/ trống. PR feat/fix phải kèm ${fragmentRel}/<tên-ngắn>.md; hoặc thêm ` +
        `${viRel} (xem changelog/vi/README.md).`,
    );
    process.exit(1);
  }
  if (hasViFile) {
    console.log(`Có ${viRel}.`);
    if (fragments.length) {
      console.log(
        `::warning file=${viRel}::Dùng ${viRel} viết tay; ${fragments.length} ghi chú trong ` +
          `${fragmentRel}/ (${fragments.map((f) => f.name).join(", ")}) bị bỏ — nội dung cần có ` +
          `trong ${viRel}.`,
      );
    }
  } else {
    console.log(
      `Gộp ${fragments.length} ghi chú trong ${fragmentRel}/ ` +
        `(${fragments.map((f) => f.name).join(", ")}) thành ${viRel}.`,
    );
  }
  if (values.check) return;

  const changelogFile = path.resolve(ROOT, values.changelog);
  if (!existsSync(changelogFile)) {
    console.error(`::error::Không có ${values.changelog} — Release PR phải có file này.`);
    process.exit(2);
  }
  const viNotes = hasViFile ? readFileSync(viFile, "utf8") : mergeViFragments(fragments);
  try {
    const { content, changed } = injectViNotes(
      readFileSync(changelogFile, "utf8"),
      version,
      viNotes,
    );
    // Chỉ ghi khi chèn được: lỗi thì không để lại <version>.md/xoá dở unreleased/.
    if (!hasViFile) writeFileSync(viFile, viNotes);
    for (const f of fragments) rmSync(f.file);
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
