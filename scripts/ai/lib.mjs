// Logic dùng chung cho công cụ agent (T0.11): đọc docs/ai/tasks.yaml, tính trạng thái task,
// chọn task tiếp theo (WORKFLOW §5–§6), xác định lane sở hữu file và file thuộc "UI" (WORKFLOW §3).
// Toàn bộ là hàm thuần — phần gọi git/GitHub nằm ở git.mjs để test được mà không cần repo.
import { readFileSync } from "node:fs";
import { parse } from "yaml";

export const AGENTS = ["claude-1", "claude-2", "codex-1"];

/** Mã task trong tiêu đề commit/PR: `[T1.4a]`. `[T1.4a-contract]` KHÔNG khớp (WORKFLOW §8). */
const TASK_REF = /\[(T\d+(?:\.\d+)?[a-z]?)\]/g;
/** Mã task trong tiêu đề PR đang mở, kể cả PR contract: `[T1.4a]`, `[T1.4a-contract]`. */
const OPEN_PR_REF = /\[(T\d+(?:\.\d+)?[a-z]?)(?:-contract)?\]/g;
/** Nhánh nhận task: `<agent>/<id>-<slug>` (WORKFLOW §5). */
const BRANCH_REF = /^[^/]+\/(T\d+(?:\.\d+)?[a-z]?)-/;

/**
 * @typedef {{ id: string, lane: string, title: string, deps: string[], est?: number, ver?: string,
 *   ui?: boolean, stealable?: boolean, human?: boolean, touches: string[] }} Task
 * @typedef {{ tool: string, name: string, owns: string[] }} Lane
 * @typedef {{ lanes: Record<string, Lane>, tasks: Task[] }} TaskFile
 */

/** @param {string} source nội dung YAML */
export function parseTasks(source) {
  const data = parse(source);
  if (!data || typeof data !== "object" || !data.lanes || !Array.isArray(data.tasks)) {
    throw new Error("tasks.yaml: thiếu `lanes` hoặc `tasks`");
  }
  /** @type {Task[]} */
  const tasks = data.tasks.map((/** @type {any} */ t) => ({
    ...t,
    id: String(t.id),
    deps: (t.deps ?? []).map(String),
    touches: (t.touches ?? []).map(String),
  }));
  const ids = new Set();
  for (const t of tasks) {
    if (ids.has(t.id)) throw new Error(`tasks.yaml: trùng id ${t.id}`);
    ids.add(t.id);
    if (!data.lanes[t.lane]) throw new Error(`tasks.yaml: ${t.id} có lane lạ "${t.lane}"`);
  }
  for (const t of tasks) {
    for (const d of t.deps) {
      if (!ids.has(d)) throw new Error(`tasks.yaml: ${t.id} phụ thuộc task không tồn tại ${d}`);
    }
  }
  /** @type {Record<string, Lane>} */
  const lanes = {};
  for (const [id, lane] of Object.entries(data.lanes)) {
    const l = /** @type {any} */ (lane);
    lanes[id] = { tool: l.tool, name: l.name, owns: (l.owns ?? []).map(String) };
  }
  return /** @type {TaskFile} */ ({ lanes, tasks });
}

/** @param {string} path */
export function loadTasks(path) {
  return parseTasks(readFileSync(path, "utf8"));
}

// ---------------------------------------------------------------------------
// Glob và vùng sở hữu
// ---------------------------------------------------------------------------

/** @type {Map<string, RegExp>} */
const globCache = new Map();

/**
 * Glob kiểu `tasks.yaml`: `**` khớp mọi thứ kể cả `/`, `*` khớp trong một đoạn đường dẫn.
 * `dir/**` khớp cả file trực tiếp lẫn lồng sâu trong `dir/`.
 * @param {string} glob
 */
export function globToRegExp(glob) {
  let re = globCache.get(glob);
  if (re) return re;
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        out += "(?:.*/)?"; // `**/` = không hoặc nhiều thư mục
      } else {
        out += ".*";
      }
    } else if (c === "*") {
      out += "[^/]*";
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  re = new RegExp(`^${out}$`);
  globCache.set(glob, re);
  return re;
}

/** @param {string} file @param {string} glob */
export function matchGlob(file, glob) {
  return globToRegExp(glob).test(file);
}

/**
 * Độ cụ thể của glob ("glob cụ thể hơn thắng", ghi chú cuối `lanes` trong tasks.yaml):
 * đường dẫn chính xác thắng mọi glob; giữa các glob, nhiều ký tự literal hơn thắng.
 * @param {string} glob
 */
export function globSpecificity(glob) {
  if (!/[*?]/.test(glob)) return Number.MAX_SAFE_INTEGER;
  return glob.replace(/[*?]/g, "").length;
}

/**
 * Lane sở hữu file (glob cụ thể nhất trong mọi `owns`), hoặc `null` nếu không lane nào sở hữu.
 * @param {string} file
 * @param {Record<string, { owns: string[] }>} lanes
 */
export function ownerOf(file, lanes) {
  /** @type {string | null} */
  let owner = null;
  let best = -1;
  for (const [laneId, lane] of Object.entries(lanes)) {
    for (const glob of lane.owns) {
      if (!matchGlob(file, glob)) continue;
      const score = globSpecificity(glob);
      if (score > best) {
        best = score;
        owner = laneId;
      }
    }
  }
  return owner;
}

/**
 * File "UI" theo WORKFLOW §3 — chỉ Claude được sửa, Codex không bao giờ (kể cả qua `touches`).
 * @param {string} file
 */
export function isUiFile(file) {
  if (file.startsWith("apps/web/src/app/")) {
    return !(
      file.startsWith("apps/web/src/app/api/") || file.startsWith("apps/web/src/app/auth/callback/")
    );
  }
  if (file.startsWith("packages/i18n/messages/")) {
    return !/\/(errors|audit)\.json$/.test(file);
  }
  return UI_GLOBS.some((g) => matchGlob(file, g));
}

const UI_GLOBS = [
  "apps/web/src/components/**",
  "apps/web/src/hooks/**",
  "apps/web/public/**",
  "apps/web/tailwind.config.*",
  "apps/web/components.json",
  "**/*.css",
  "packages/editor/src/extensions/**",
  "packages/editor/src/ui/**",
  "packages/editor/src/table/drag.ts",
  "packages/emails/**",
  "docs/user-guide/**",
  "docs/glossary.md",
  "changelog/vi/**",
  "apps/web/e2e/editor/**",
  "apps/web/e2e/table/**",
  "apps/web/e2e/features/**",
];

// ---------------------------------------------------------------------------
// Trạng thái task
// ---------------------------------------------------------------------------

/**
 * Mã task đã xong từ tiêu đề commit trên `main`.
 * @param {string[]} subjects
 */
export function doneIdsFromSubjects(subjects) {
  const done = new Set();
  for (const s of subjects) for (const m of s.matchAll(TASK_REF)) done.add(m[1]);
  return done;
}

/**
 * Mã task đang làm từ nhánh remote (`origin/` đã bỏ) và tiêu đề PR đang mở.
 * @param {string[]} branches
 * @param {string[]} openPrTitles
 */
export function inProgressIds(branches, openPrTitles) {
  const ids = new Set();
  for (const b of branches) {
    const m = b.match(BRANCH_REF);
    if (m) ids.add(m[1]);
  }
  for (const t of openPrTitles) for (const m of t.matchAll(OPEN_PR_REF)) ids.add(m[1]);
  return ids;
}

/**
 * @typedef {"done" | "in_progress" | "ready" | "blocked"} Status
 * @typedef {Task & { status: Status, waitingOn: string[] }} TaskState
 */

/**
 * @param {Task[]} tasks
 * @param {Set<string>} done
 * @param {Set<string>} inProgress
 * @returns {TaskState[]}
 */
export function computeStates(tasks, done, inProgress) {
  return tasks.map((t) => {
    const waitingOn = t.deps.filter((d) => !done.has(d));
    /** @type {Status} */
    let status;
    if (done.has(t.id)) status = "done";
    else if (inProgress.has(t.id)) status = "in_progress";
    else if (waitingOn.length > 0) status = "blocked";
    else status = "ready";
    return { ...t, status, waitingOn };
  });
}

/**
 * Số task phụ thuộc (trực tiếp hoặc gián tiếp) vào mỗi task — thước đo "đường găng" (WORKFLOW §6.5).
 * @param {Task[]} tasks
 */
export function dependentCounts(tasks) {
  /** @type {Map<string, string[]>} */
  const children = new Map(tasks.map((t) => [t.id, []]));
  for (const t of tasks) for (const d of t.deps) children.get(d)?.push(t.id);
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const t of tasks) {
    const seen = new Set();
    const stack = [...(children.get(t.id) ?? [])];
    while (stack.length) {
      const id = /** @type {string} */ (stack.pop());
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(children.get(id) ?? []));
    }
    counts.set(t.id, seen.size);
  }
  return counts;
}

/** @param {string} agent */
export const isCodex = (agent) => agent.startsWith("codex-");

/**
 * Chọn task tiếp theo cho agent (WORKFLOW §5), rồi tới mượn task (§6) nếu lane hết việc.
 * Claude mượn task UI của Claude khác cần người đồng ý → chỉ xét khi `allowUiSteal`.
 * @param {TaskState[]} states
 * @param {string} agent
 * @param {{ allowUiSteal?: boolean }} [opts]
 * @returns {{ task: TaskState, stolenFrom?: string } | null}
 */
export function pickNext(states, agent, opts = {}) {
  const own = states.find(
    (t) => t.lane === agent && t.status === "ready" && !(isCodex(agent) && t.ui),
  );
  if (own) return { task: own };

  const counts = dependentCounts(states);
  const candidates = states
    .map((t, index) => ({ t, index }))
    .filter(({ t }) => {
      if (t.lane === agent || t.status !== "ready" || !t.stealable) return false;
      if (t.ui) return !isCodex(agent) && Boolean(opts.allowUiSteal);
      return true;
    })
    .sort((a, b) => (counts.get(b.t.id) ?? 0) - (counts.get(a.t.id) ?? 0) || a.index - b.index);
  const first = candidates[0];
  return first ? { task: first.t, stolenFrom: first.t.lane } : null;
}
