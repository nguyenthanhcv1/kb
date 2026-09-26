#!/usr/bin/env node
// `pnpm ai:status` — tổng quan từng lane: đang làm, ready, đang chờ gì (WORKFLOW §10).
// Tuỳ chọn: --json, --no-fetch, --no-prs, --lane <id> (chỉ một lane).
import { fileURLToPath } from "node:url";
import { parseArgs, readRepoState } from "./git.mjs";
import { computeStates, loadTasks, pickNext } from "./lib.mjs";

const TASKS_PATH = fileURLToPath(new URL("../../docs/ai/tasks.yaml", import.meta.url));

const args = parseArgs(process.argv.slice(2));
const { lanes, tasks } = loadTasks(TASKS_PATH);
const repo = await readRepoState({ fetch: !args["no-fetch"], prs: !args["no-prs"] });
for (const w of repo.warnings) console.error(`⚠ ${w}`);

const states = computeStates(tasks, repo.done, repo.inProgress);
const laneIds = Object.keys(lanes).filter(
  (l) => l !== "human" && (typeof args.lane !== "string" || l === args.lane),
);

if (args.json) {
  const out = Object.fromEntries(
    laneIds.map((l) => [
      l,
      states
        .filter((t) => t.lane === l)
        .map(({ id, status, waitingOn }) => ({ id, status, waitingOn })),
    ]),
  );
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

const total = states.length;
const doneCount = states.filter((t) => t.status === "done").length;
console.log(`MVP: ${doneCount}/${total} task đã merge vào main\n`);

for (const l of laneIds) {
  const mine = states.filter((t) => t.lane === l);
  const by = (/** @type {string} */ s) => mine.filter((t) => t.status === s);
  const done = by("done");
  const est = (/** @type {typeof mine} */ list) => list.reduce((s, t) => s + (t.est ?? 0), 0);
  console.log(
    `${l} — ${lanes[l].name}: ${done.length}/${mine.length} xong (${est(done)}/${est(mine)} ngày công)`,
  );
  const inProgress = by("in_progress");
  const ready = by("ready");
  const blocked = by("blocked");
  if (inProgress.length) console.log(`  đang làm : ${inProgress.map((t) => t.id).join(", ")}`);
  if (ready.length) console.log(`  ready    : ${ready.map((t) => t.id).join(", ")}`);
  const next = pickNext(states, l);
  if (next?.stolenFrom) console.log(`  mượn được: ${next.task.id} (lane ${next.stolenFrom})`);
  if (blocked.length) {
    // Chỉ hiện vài task chờ gần nhất (theo thứ tự ưu tiên) cho gọn.
    const shown = blocked.slice(0, 5);
    console.log(
      `  đang chờ : ${shown.map((t) => `${t.id}←${t.waitingOn.join("+")}`).join(", ")}` +
        (blocked.length > shown.length ? ` … (+${blocked.length - shown.length})` : ""),
    );
  }
  console.log("");
}
