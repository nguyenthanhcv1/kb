#!/usr/bin/env node
// `pnpm ai:next` — task ready đầu tiên theo thứ tự trong docs/ai/tasks.yaml (WORKFLOW §4).
// Mọi agent dùng chung một hàng đợi; task đã có người nhận (nhánh/PR `[Txx]`) bị bỏ qua.
// Tuỳ chọn: --json, --no-fetch (không `git fetch`), --no-prs (không gọi GitHub API),
//           --skip T1.2,T1.3 (bỏ qua các task này), --all (liệt kê mọi task ready theo thứ tự).
import { fileURLToPath } from "node:url";
import { parseArgs, readRepoState } from "./git.mjs";
import { computeStates, loadTasks, pickNext } from "./lib.mjs";

const TASKS_PATH = fileURLToPath(new URL("../../docs/ai/tasks.yaml", import.meta.url));

const args = parseArgs(process.argv.slice(2));
const skip = typeof args.skip === "string" ? args.skip.split(",").map((s) => s.trim()) : [];

const { tasks } = loadTasks(TASKS_PATH);
const repo = await readRepoState({ fetch: !args["no-fetch"], prs: !args["no-prs"] });
for (const w of repo.warnings) console.error(`⚠ ${w}`);

const states = computeStates(tasks, repo.done, repo.inProgress);

if (args.all) {
  const ready = states.filter((t) => t.status === "ready" && !t.manual && !skip.includes(t.id));
  if (args.json) console.log(JSON.stringify(ready));
  else for (const t of ready) console.log(`${t.id}  ${t.title}`);
  process.exit(ready.length ? 0 : 1);
}

const t = pickNext(states, { skip });

if (args.json) {
  console.log(JSON.stringify(t));
  process.exit(0);
}

if (!t) {
  const inProgress = states.filter((s) => s.status === "in_progress");
  const blocked = states.filter((s) => s.status === "blocked").slice(0, 5);
  const manual = states.filter((s) => s.status === "ready" && s.manual);
  console.log("Không còn task ready nào cho agent.");
  if (inProgress.length) console.log(`Đang làm: ${inProgress.map((s) => s.id).join(", ")}`);
  if (manual.length) console.log(`Chờ người làm: ${manual.map((s) => s.id).join(", ")}`);
  if (blocked.length) {
    console.log("Đang chờ:");
    for (const s of blocked) console.log(`  ${s.id} ← ${s.waitingOn.join(", ")}`);
  }
  process.exit(1);
}

const flags = [t.ui && "ui", t.human && "human"].filter(Boolean);
console.log(`${t.id}  ${t.title}`);
console.log(
  `  deps: ${t.deps.join(", ") || "—"} · est: ${t.est ?? "?"} · ver: ${t.ver ?? "?"}${flags.length ? ` · ${flags.join(", ")}` : ""}`,
);
console.log(`  mô tả + tiêu chí hoàn thành: docs/PLAN.md §9 (dòng "${t.id}")`);
