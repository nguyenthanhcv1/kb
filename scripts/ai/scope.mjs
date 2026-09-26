#!/usr/bin/env node
// CI `agent-scope` (T0.11): so file PR thay đổi với vùng được sửa của task ghi trong thân PR.
//   Vùng được sửa = `owns` của lane gốc của task + `touches` của task (WORKFLOW §6.3, tasks.yaml).
//   Codex không bao giờ được sửa file UI (WORKFLOW §3), kể cả qua `touches`.
// Chạy trong CI: env PR_BODY, PR_TITLE, PR_AUTHOR_TYPE, BASE_SHA, HEAD_SHA (xem agent-scope.yml).
// Chạy local:   PR_BODY="$(cat body.md)" PR_TITLE="…" node scripts/ai/scope.mjs --base origin/main
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./git.mjs";
import { AGENTS, isCodex, isUiFile, matchGlob, ownerOf, parseTasks } from "./lib.mjs";

/**
 * Quy tắc WORKFLOW §7/§8 chưa biểu diễn được bằng `owns`/`touches` trong tasks.yaml.
 * Nếu người điều phối chuyển chúng vào tasks.yaml thì xoá khỏi đây.
 */
export const EXTRA_RULES = {
  /** File sinh tự động, lane nào cũng có thể đổi qua `pnpm add --filter …` (§7). */
  anyAgent: ["pnpm-lock.yaml"],
  /** Chỉ release-please/người sửa (§7) — agent không bao giờ đụng. */
  forbidden: ["CHANGELOG.md", ".release-please-manifest.json"],
  /**
   * Chủ sở hữu dự phòng cho file không khớp `owns` nào: root config còn lại thuộc `claude-2`
   * (§7 "Root config …, ESLint …").
   */
  fallbackOwners: /** @type {Record<string, string[]>} */ ({
    "claude-2": [
      ".editorconfig",
      ".gitignore",
      ".npmrc",
      ".nvmrc",
      ".prettierignore",
      "*.config.mjs",
      "*.config.js",
      "*.config.ts",
    ],
  }),
  /** Mock dữ liệu của task UI khi contract chưa xong (§8.2) — chỉ task `ui: true`. */
  uiTask: ["apps/web/src/server/*/mock*.ts"],
  /** Component shadcn MỚI (file mới) — task UI nào cũng thêm được (§7, CLAUDE.md). */
  uiTaskAddOnly: ["apps/web/src/components/ui/**"],
};

/**
 * Lane sở hữu file: `owns` trong tasks.yaml, rồi tới `EXTRA_RULES.fallbackOwners`.
 * @param {string} file
 * @param {import("./lib.mjs").TaskFile["lanes"]} lanes
 */
export function resolveOwner(file, lanes) {
  return ownerOf(file, lanes) ?? ownerOf(file, objectMap(EXTRA_RULES.fallbackOwners));
}

/** @param {Record<string, string[]>} rec */
const objectMap = (rec) =>
  Object.fromEntries(Object.entries(rec).map(([k, owns]) => [k, { owns }]));

/** Bỏ comment HTML của PR template trước khi đọc các dòng `Agent:`/`Task:`. */
const stripComments = (/** @type {string} */ s) => s.replace(/<!--[\s\S]*?-->/g, "");

/**
 * Đọc `Agent:` và `Task:` trong thân PR.
 * @param {string} body
 * @returns {{ agent: string | null, borrowedFrom: string | null, task: string | null }}
 */
export function parsePrBody(body) {
  const text = stripComments(body ?? "");
  const agentLine = text.match(/^\s*Agent:\s*(.+)$/im)?.[1].trim() ?? "";
  const taskLine = text.match(/^\s*Task:\s*(.+)$/im)?.[1].trim() ?? "";
  const agent = agentLine.match(/^`?(claude-\d|codex-\d|human)`?/i)?.[1].toLowerCase() ?? null;
  const borrowedFrom =
    agentLine.match(/mượn từ lane\s+`?([a-z]+-\d)`?/i)?.[1].toLowerCase() ?? null;
  const task = taskLine.match(/\b(T\d+(?:\.\d+)?[a-z]?)\b/)?.[1] ?? null;
  return { agent, borrowedFrom, task };
}

/**
 * @typedef {{ status: string, path: string }} ChangedFile  status: A | M | D | R… (git --name-status)
 * @typedef {{ errors: string[], warnings: string[], notes: string[] }} ScopeResult
 */

/**
 * @param {{
 *   taskFile: import("./lib.mjs").TaskFile,
 *   body: string,
 *   title: string,
 *   files: ChangedFile[],
 *   authorIsBot?: boolean,
 * }} input
 * @returns {ScopeResult}
 */
export function checkScope({ taskFile, body, title, files, authorIsBot = false }) {
  /** @type {ScopeResult} */
  const r = { errors: [], warnings: [], notes: [] };

  if (authorIsBot) {
    r.notes.push("PR do bot tạo (release-please, dependabot…) — bỏ qua kiểm tra lane.");
    return r;
  }

  const { agent, borrowedFrom, task: taskId } = parsePrBody(body);
  if (!agent) {
    r.errors.push(
      `Thân PR thiếu dòng "Agent: <${[...AGENTS, "human"].join(" | ")}>" (PR template).`,
    );
    return r;
  }
  if (agent === "human") {
    r.notes.push("Agent: human — người điều phối không bị giới hạn lane; reviewer tự kiểm tra.");
    return r;
  }
  if (!AGENTS.includes(agent)) {
    r.errors.push(`Agent "${agent}" không có trong danh sách: ${AGENTS.join(", ")}.`);
    return r;
  }

  // Codex không bao giờ sửa UI — kiểm tra trước mọi thứ khác, không phụ thuộc task.
  if (isCodex(agent)) {
    for (const f of files) {
      if (isUiFile(f.path)) {
        r.errors.push(
          `${f.path}: file UI — Codex không được sửa (WORKFLOW §3). Ghi "Yêu cầu cho lane khác".`,
        );
      }
    }
  }

  if (!taskId) {
    r.errors.push('Thân PR thiếu dòng "Task: Txx" (PR template).');
    return r;
  }
  const task = taskFile.tasks.find((t) => t.id === taskId);
  if (!task) {
    r.errors.push(`Task ${taskId} không có trong docs/ai/tasks.yaml.`);
    return r;
  }

  const titleIds = [...title.matchAll(/\[(T\d+(?:\.\d+)?[a-z]?)(?:-contract)?\]/g)].map(
    (m) => m[1],
  );
  if (!titleIds.includes(taskId)) {
    r.errors.push(`Tiêu đề PR phải chứa "[${taskId}]" (khớp dòng Task:).`);
  }

  // Lane: đúng lane của task, hoặc mượn hợp lệ (WORKFLOW §6).
  if (task.lane !== agent) {
    if (!borrowedFrom) {
      r.errors.push(
        `${taskId} thuộc lane ${task.lane}, không phải ${agent}. Mượn task thì ghi ` +
          `"Agent: ${agent} (mượn từ lane ${task.lane})" (WORKFLOW §6).`,
      );
    } else if (borrowedFrom !== task.lane) {
      r.errors.push(`Ghi "mượn từ lane ${borrowedFrom}" nhưng ${taskId} thuộc lane ${task.lane}.`);
    } else if (!isCodex(agent) && !isCodex(task.lane)) {
      // Claude ↔ Claude: được mượn khi người đồng ý (§6.2) — CI không kiểm được, reviewer xác nhận.
      r.warnings.push(`Claude mượn task của ${task.lane} — cần người đồng ý (WORKFLOW §6.2).`);
    } else if (!task.stealable) {
      r.errors.push(`${taskId} không có "stealable: true" — không được mượn (WORKFLOW §6.1).`);
    } else if (task.ui && isCodex(agent)) {
      r.errors.push(`${taskId} là task UI — Codex không bao giờ mượn task UI (WORKFLOW §6.2).`);
    }
  }

  const lane = task.lane;
  for (const f of files) {
    const p = f.path;
    if (EXTRA_RULES.forbidden.includes(p)) {
      r.errors.push(`${p}: chỉ release-please được sửa (WORKFLOW §7).`);
      continue;
    }
    if (EXTRA_RULES.anyAgent.includes(p)) continue;
    const owner = resolveOwner(p, taskFile.lanes);
    if (owner === lane) continue;
    if (task.touches.some((g) => matchGlob(p, g))) continue;
    if (task.ui && EXTRA_RULES.uiTask.some((g) => matchGlob(p, g))) continue;
    if (task.ui && f.status === "A" && EXTRA_RULES.uiTaskAddOnly.some((g) => matchGlob(p, g))) {
      continue;
    }
    if (!owner) {
      // Không lane nào sở hữu (vd package.json của một package) → không đụng ai, reviewer xem.
      r.warnings.push(`${p}: không lane nào sở hữu — reviewer xác nhận thuộc phạm vi ${taskId}.`);
      continue;
    }
    r.errors.push(
      `${p}: thuộc lane ${owner}, ngoài vùng của ${taskId} (lane ${lane}). ` +
        `Chuyển thành "Yêu cầu cho lane khác" hoặc nhờ người thêm vào \`touches\`.`,
    );
  }

  r.notes.push(
    `Agent ${agent}${borrowedFrom ? ` (mượn từ ${borrowedFrom})` : ""} · task ${taskId} (lane ${lane}) · ${files.length} file.`,
  );
  return r;
}

/**
 * `git diff --name-status -z` → danh sách file. File đổi tên tính cả đường dẫn cũ và mới
 * (xoá file cũ cũng là sửa vùng của lane sở hữu nó).
 * @param {string} raw
 * @returns {ChangedFile[]}
 */
export function parseNameStatus(raw) {
  const parts = raw.split("\0").filter(Boolean);
  /** @type {ChangedFile[]} */
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i];
    if (status.startsWith("R") || status.startsWith("C")) {
      const from = parts[++i];
      const to = parts[++i];
      if (status.startsWith("R")) files.push({ status: "D", path: from });
      files.push({ status: "A", path: to });
    } else {
      files.push({ status: status[0], path: parts[++i] });
    }
  }
  return files;
}

/** @param {string[]} args */
const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = process.env.BASE_SHA || (typeof args.base === "string" ? args.base : "origin/main");
  const head = process.env.HEAD_SHA || (typeof args.head === "string" ? args.head : "HEAD");

  // tasks.yaml đọc từ nhánh gốc, không phải từ PR — PR không tự nới vùng của mình được.
  const taskFile = parseTasks(git(["show", `${base}:docs/ai/tasks.yaml`]));
  const files = parseNameStatus(git(["diff", "--name-status", "-z", "-M", `${base}...${head}`]));

  const result = checkScope({
    taskFile,
    body: process.env.PR_BODY ?? "",
    title: process.env.PR_TITLE ?? "",
    files,
    authorIsBot: process.env.PR_AUTHOR_TYPE === "Bot",
  });

  for (const n of result.notes) console.log(n);
  for (const w of result.warnings) console.log(`::warning::${w}`);
  for (const e of result.errors) console.log(`::error::${e}`);
  if (result.errors.length) {
    console.log(
      `\nagent-scope: ${result.errors.length} lỗi. Quy tắc: AGENTS.md §0, docs/ai/WORKFLOW.md §3, §6, §7.`,
    );
    process.exit(1);
  }
  console.log("agent-scope: OK");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
