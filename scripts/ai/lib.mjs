// Logic dùng chung cho công cụ agent: đọc docs/ai/tasks.yaml, tính trạng thái task và chọn task
// tiếp theo (WORKFLOW §4). Không còn lane — mọi agent dùng chung một hàng đợi theo thứ tự file.
// Toàn bộ là hàm thuần — phần gọi git/GitHub nằm ở git.mjs để test được mà không cần repo.
import { readFileSync } from "node:fs";
import { parse } from "yaml";

/** Mã task trong tiêu đề commit/PR: `[T1.4a]`. `[T1.4a-contract]` KHÔNG khớp (WORKFLOW §6). */
const TASK_REF = /\[(T\d+(?:\.\d+)?[a-z]?)\]/g;
/** Mã task trong tiêu đề PR đang mở, kể cả PR contract: `[T1.4a]`, `[T1.4a-contract]`. */
export const OPEN_PR_REF = /\[(T\d+(?:\.\d+)?[a-z]?)(?:-contract)?\]/g;
/** Nhánh nhận task: `<agent>/<id>-<slug>` (WORKFLOW §4). */
const BRANCH_REF = /^[^/]+\/(T\d+(?:\.\d+)?[a-z]?)-/;

/**
 * @typedef {{ id: string, title: string, deps: string[], est?: number, ver?: string,
 *   ui?: boolean, human?: boolean, manual?: boolean }} Task
 * @typedef {{ tasks: Task[] }} TaskFile
 */

/**
 * Đọc tasks.yaml. Trường lạ (vd `lane`, `lanes` của định dạng cũ) được bỏ qua.
 * Mỗi task phải đứng sau mọi deps của nó — thứ tự file là thứ tự thực hiện.
 * @param {string} source nội dung YAML
 */
export function parseTasks(source) {
  const data = parse(source);
  if (!data || typeof data !== "object" || !Array.isArray(data.tasks)) {
    throw new Error("tasks.yaml: thiếu `tasks`");
  }
  /** @type {Task[]} */
  const tasks = data.tasks.map((/** @type {any} */ t) => ({
    id: String(t.id),
    title: String(t.title ?? ""),
    deps: (t.deps ?? []).map(String),
    est: t.est,
    ver: t.ver === undefined ? undefined : String(t.ver),
    ui: Boolean(t.ui),
    human: Boolean(t.human),
    manual: Boolean(t.manual) || t.lane === "human",
  }));
  const ids = new Set(tasks.map((t) => t.id));
  if (ids.size !== tasks.length) {
    const dup = tasks.find((t, i) => tasks.findIndex((u) => u.id === t.id) !== i);
    throw new Error(`tasks.yaml: trùng id ${dup?.id}`);
  }
  const seen = new Set();
  for (const t of tasks) {
    for (const d of t.deps) {
      if (!ids.has(d)) throw new Error(`tasks.yaml: ${t.id} phụ thuộc task không tồn tại ${d}`);
      if (!seen.has(d)) throw new Error(`tasks.yaml: ${t.id} phải đứng sau task phụ thuộc ${d}`);
    }
    seen.add(t.id);
  }
  return /** @type {TaskFile} */ ({ tasks });
}

/** @param {string} path */
export function loadTasks(path) {
  return parseTasks(readFileSync(path, "utf8"));
}

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
 * Task tiếp theo: task `ready` đầu tiên theo thứ tự file, bỏ qua task chỉ người làm (`manual`)
 * và task trong `skip` (vd agent vừa thử nhận nhưng thấy người khác đã nhận).
 * @param {TaskState[]} states
 * @param {{ skip?: Iterable<string> }} [opts]
 * @returns {TaskState | null}
 */
export function pickNext(states, opts = {}) {
  const skip = new Set(opts.skip ?? []);
  return states.find((t) => t.status === "ready" && !t.manual && !skip.has(t.id)) ?? null;
}
