#!/usr/bin/env node
// CI `agent-scope`: PR gắn đúng một task trong docs/ai/tasks.yaml và không phá quy tắc chung.
//   Không còn lane/vùng sở hữu — agent nào cũng làm được task nào, sửa được file nào task cần.
//   Kiểm tra: dòng `Agent:`/`Task:` trong thân PR, `[Txx]` trong tiêu đề, deps đã merge vào nhánh
//   gốc, không sửa file chỉ release-please được sửa (WORKFLOW §5).
// Chạy trong CI: env PR_BODY, PR_TITLE, PR_AUTHOR_TYPE, BASE_SHA, HEAD_SHA (xem agent-scope.yml).
// Chạy local:   PR_BODY="$(cat body.md)" PR_TITLE="…" node scripts/ai/scope.mjs --base origin/main
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./git.mjs";
import { doneIdsFromSubjects, OPEN_PR_REF, parseTasks } from "./lib.mjs";

/** Chỉ release-please/người sửa (WORKFLOW §5) — agent không bao giờ đụng. */
export const FORBIDDEN = ["CHANGELOG.md", ".release-please-manifest.json"];

/** Bỏ comment HTML của PR template trước khi đọc các dòng `Agent:`/`Task:`. */
const stripComments = (/** @type {string} */ s) => s.replace(/<!--[\s\S]*?-->/g, "");

/**
 * Đọc `Agent:` và `Task:` trong thân PR. Agent là tên tự do (`claude`, `codex`, `claude-2`, `human`…).
 * @param {string} body
 * @returns {{ agent: string | null, task: string | null }}
 */
export function parsePrBody(body) {
  const text = stripComments(body ?? "");
  const agentLine = text.match(/^\s*Agent:[ \t]*(.*)$/im)?.[1].trim() ?? "";
  const taskLine = text.match(/^\s*Task:[ \t]*(.*)$/im)?.[1].trim() ?? "";
  const agent = agentLine.match(/^`?([a-z][\w.-]*)`?/i)?.[1].toLowerCase() ?? null;
  const task = taskLine.match(/\b(T\d+(?:\.\d+)?[a-z]?)\b/)?.[1] ?? null;
  return { agent, task };
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
 *   done?: Set<string>,
 *   authorIsBot?: boolean,
 * }} input
 *   `done`: task đã merge vào nhánh gốc; bỏ trống thì không kiểm tra deps.
 * @returns {ScopeResult}
 */
export function checkScope({ taskFile, body, title, files, done, authorIsBot = false }) {
  /** @type {ScopeResult} */
  const r = { errors: [], warnings: [], notes: [] };

  if (authorIsBot) {
    r.notes.push("PR do bot tạo (release-please, dependabot…) — bỏ qua kiểm tra.");
    return r;
  }

  for (const f of files) {
    if (FORBIDDEN.includes(f.path)) r.errors.push(`${f.path}: chỉ release-please được sửa.`);
  }

  const { agent, task: taskId } = parsePrBody(body);
  if (!agent) {
    r.errors.push('Thân PR thiếu dòng "Agent: <tên agent | human>" (PR template).');
    return r;
  }
  if (agent === "human") {
    r.notes.push(
      "Agent: human — PR của người điều phối, không bắt buộc Task; reviewer tự kiểm tra.",
    );
    return r;
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
  if (task.manual) {
    r.errors.push(`${taskId} là task chỉ người làm (manual) — PR phải ghi "Agent: human".`);
  }

  const titleIds = [...title.matchAll(OPEN_PR_REF)].map((m) => m[1]);
  if (!titleIds.includes(taskId)) {
    r.errors.push(`Tiêu đề PR phải chứa "[${taskId}]" (khớp dòng Task:).`);
  }
  const others = [...new Set(titleIds.filter((id) => id !== taskId))];
  if (others.length) {
    r.errors.push(
      `Một PR = một task: tiêu đề còn chứa ${others.map((id) => `[${id}]`).join(", ")}.`,
    );
  }

  if (done) {
    const missing = task.deps.filter((d) => !done.has(d));
    if (missing.length) {
      r.errors.push(
        `${taskId} phụ thuộc ${missing.join(", ")} chưa merge vào nhánh gốc — merge sau khi deps xong ` +
          "(PR `b` dựng sẵn trên contract/mock được, nhưng chỉ merge khi `a` đã merge).",
      );
    }
  }

  r.notes.push(`Agent ${agent} · task ${taskId} · ${files.length} file.`);
  return r;
}

/**
 * `git diff --name-status -z` → danh sách file. File đổi tên tính cả đường dẫn cũ và mới.
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

  // tasks.yaml đọc từ nhánh gốc, không phải từ PR — PR không tự thêm/đổi task của mình được.
  const taskFile = parseTasks(git(["show", `${base}:docs/ai/tasks.yaml`]));
  const files = parseNameStatus(git(["diff", "--name-status", "-z", "-M", `${base}...${head}`]));
  const done = doneIdsFromSubjects(git(["log", base, "--format=%s"]).split("\n"));

  const result = checkScope({
    taskFile,
    body: process.env.PR_BODY ?? "",
    title: process.env.PR_TITLE ?? "",
    files,
    done,
    authorIsBot: process.env.PR_AUTHOR_TYPE === "Bot",
  });

  for (const n of result.notes) console.log(n);
  for (const w of result.warnings) console.log(`::warning::${w}`);
  for (const e of result.errors) console.log(`::error::${e}`);
  if (result.errors.length) {
    console.log(
      `\nagent-scope: ${result.errors.length} lỗi. Quy tắc: AGENTS.md §0, docs/ai/WORKFLOW.md.`,
    );
    process.exit(1);
  }
  console.log("agent-scope: OK");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
