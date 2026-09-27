#!/usr/bin/env node
// `pnpm ai:status` — tổng quan hàng đợi task: đã xong, đang làm, ready, đang chờ gì (WORKFLOW §8).
// Tuỳ chọn: --json, --no-fetch, --no-prs.
import { fileURLToPath } from "node:url";
import { parseArgs, readRepoState } from "./git.mjs";
import { computeStates, loadTasks, pickNext } from "./lib.mjs";

const TASKS_PATH = fileURLToPath(new URL("../../docs/ai/tasks.yaml", import.meta.url));

const args = parseArgs(process.argv.slice(2));
const { tasks } = loadTasks(TASKS_PATH);
const repo = await readRepoState({ fetch: !args["no-fetch"], prs: !args["no-prs"] });
for (const w of repo.warnings) console.error(`⚠ ${w}`);

const states = computeStates(tasks, repo.done, repo.inProgress);

if (args.json) {
  console.log(
    JSON.stringify(
      states.map(({ id, status, waitingOn }) => ({ id, status, waitingOn })),
      null,
      2,
    ),
  );
  process.exit(0);
}

const by = (/** @type {string} */ s) => states.filter((t) => t.status === s);
const est = (/** @type {typeof states} */ list) => list.reduce((s, t) => s + (t.est ?? 0), 0);
const done = by("done");
console.log(
  `MVP: ${done.length}/${states.length} task đã merge vào main (${est(done)}/${est(states)} ngày công)\n`,
);

const inProgress = by("in_progress");
const ready = by("ready");
const blocked = by("blocked");
if (inProgress.length) console.log(`đang làm : ${inProgress.map((t) => t.id).join(", ")}`);
if (ready.length) {
  console.log(`ready    : ${ready.map((t) => (t.manual ? `${t.id} (người)` : t.id)).join(", ")}`);
}
const next = pickNext(states);
if (next) console.log(`tiếp theo: ${next.id}  ${next.title}`);
if (blocked.length) {
  // Chỉ hiện vài task chờ gần nhất (theo thứ tự ưu tiên) cho gọn.
  const shown = blocked.slice(0, 8);
  console.log(
    `đang chờ : ${shown.map((t) => `${t.id}←${t.waitingOn.join("+")}`).join(", ")}` +
      (blocked.length > shown.length ? ` … (+${blocked.length - shown.length})` : ""),
  );
}
