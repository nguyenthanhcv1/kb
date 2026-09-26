#!/usr/bin/env node
// Kiểm tra license của mọi dependency (AGENTS.md §5). Chạy: `pnpm licenses:check`.
// Nguồn dữ liệu: `pnpm licenses list --json -r` (đọc node_modules đã cài, không cần mạng).
// Chính sách: scripts/licenses/policy.json. Thoát 1 nếu có package vi phạm.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Tách biểu thức SPDX thành token: `(`, `)`, `AND`, `OR`, id license.
 * `WITH <exception>` được gộp vào id đứng trước (vd `GPL-2.0 WITH Classpath-exception-2.0`).
 * @param {string} expr
 */
function tokenize(expr) {
  const raw = expr.replace(/[()]/g, " $& ").trim().split(/\s+/).filter(Boolean);
  /** @type {string[]} */
  const tokens = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].toUpperCase() === "WITH" && tokens.length > 0 && raw[i + 1]) {
      tokens[tokens.length - 1] += ` WITH ${raw[++i]}`;
    } else {
      tokens.push(raw[i]);
    }
  }
  return tokens;
}

/**
 * Biểu thức SPDX có được phép không: `OR` → một vế được phép là đủ, `AND` → mọi vế phải được phép.
 * Biểu thức không parse được → không được phép.
 * @param {string} expr
 * @param {(id: string) => boolean} isAllowedId
 */
export function isExpressionAllowed(expr, isAllowedId) {
  const tokens = tokenize(expr);
  let pos = 0;

  /** @returns {boolean} */
  function parseOr() {
    let value = parseAnd();
    while (tokens[pos]?.toUpperCase() === "OR") {
      pos++;
      const right = parseAnd();
      value = value || right;
    }
    return value;
  }

  /** @returns {boolean} */
  function parseAnd() {
    let value = parseAtom();
    while (tokens[pos]?.toUpperCase() === "AND") {
      pos++;
      const right = parseAtom();
      value = value && right;
    }
    return value;
  }

  /** @returns {boolean} */
  function parseAtom() {
    const token = tokens[pos++];
    if (token === undefined || token === ")") throw new Error(`Invalid SPDX expression: ${expr}`);
    if (token === "(") {
      const value = parseOr();
      if (tokens[pos++] !== ")") throw new Error(`Invalid SPDX expression: ${expr}`);
      return value;
    }
    return isAllowedId(token);
  }

  try {
    const value = parseOr();
    return pos === tokens.length && value;
  } catch {
    return false;
  }
}

/**
 * Tên package khớp mẫu ngoại lệ (hỗ trợ `*` ở cuối, vd `@img/sharp-libvips-*`).
 * @param {string} name
 * @param {string} pattern
 */
function matchesPattern(name, pattern) {
  return pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern;
}

/**
 * @typedef {{ allowed: string[], exceptions: Record<string, { license: string, reason: string }> }} Policy
 * @typedef {{ name: string, versions: string[], license: string }} Violation
 */

/**
 * Tìm package vi phạm trong output JSON của `pnpm licenses list --json`
 * (dạng `{ "<license>": [{ name, versions, ... }] }`).
 * @param {Record<string, Array<{ name: string, versions?: string[], version?: string }>>} report
 * @param {Policy} policy
 * @returns {Violation[]}
 */
export function findViolations(report, policy) {
  const allowed = new Set(policy.allowed);
  /** @type {Violation[]} */
  const violations = [];
  for (const [license, packages] of Object.entries(report)) {
    if (isExpressionAllowed(license, (id) => allowed.has(id))) continue;
    for (const pkg of packages) {
      const excepted = Object.entries(policy.exceptions).some(
        ([pattern, rule]) => matchesPattern(pkg.name, pattern) && rule.license === license,
      );
      if (excepted) continue;
      violations.push({
        name: pkg.name,
        versions: pkg.versions ?? (pkg.version ? [pkg.version] : []),
        license,
      });
    }
  }
  return violations.sort((a, b) => a.name.localeCompare(b.name));
}

function main() {
  const policyPath = fileURLToPath(new URL("./policy.json", import.meta.url));
  /** @type {Policy} */
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  const output = execFileSync("pnpm", ["licenses", "list", "--json", "--recursive"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const report = JSON.parse(output);
  const total = Object.values(report).reduce((sum, list) => sum + list.length, 0);
  const violations = findViolations(report, policy);

  if (violations.length === 0) {
    console.log(`licenses:check OK (${total} package(s))`);
    return;
  }
  console.error(`licenses:check FAILED — ${violations.length} package(s) outside the allowlist:`);
  for (const v of violations) {
    console.error(`  - ${v.name}@${v.versions.join(", ")}: ${v.license}`);
  }
  console.error(
    `\nAllowed: ${policy.allowed.join(", ")}. Replace the dependency, or propose a reviewed exception in scripts/licenses/policy.json.`,
  );
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
