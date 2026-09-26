#!/usr/bin/env node
// `pnpm ai:next --agent <id>` — task tiếp theo của lane theo WORKFLOW §5, rồi mượn task (§6).
// Tuỳ chọn: --json, --no-fetch (không `git fetch`), --no-prs (không gọi GitHub API),
//           --allow-ui-steal (Claude xét cả task UI của Claude khác — cần người đồng ý).
import { fileURLToPath } from "node:url";
import { parseArgs, readRepoState } from "./git.mjs";
import { AGENTS, computeStates, loadTasks, pickNext } from "./lib.mjs";

const TASKS_PATH = fileURLToPath(new URL("../../docs/ai/tasks.yaml", import.meta.url));

const args = parseArgs(process.argv.slice(2));
const agent = typeof args.agent === "string" ? args.agent : "";
if (!AGENTS.includes(agent)) {
  console.error(
    `Dùng: pnpm ai:next --agent <${AGENTS.join("|")}> [--json] [--no-fetch] [--no-prs]`,
  );
  process.exit(2);
}

const { tasks } = loadTasks(TASKS_PATH);
const repo = await readRepoState({ fetch: !args["no-fetch"], prs: !args["no-prs"] });
for (const w of repo.warnings) console.error(`⚠ ${w}`);

const states = computeStates(tasks, repo.done, repo.inProgress);
const pick = pickNext(states, agent, { allowUiSteal: Boolean(args["allow-ui-steal"]) });

if (args.json) {
  console.log(JSON.stringify(pick ? { ...pick.task, stolenFrom: pick.stolenFrom ?? null } : null));
  process.exit(0);
}

if (!pick) {
  const waiting = states.filter((t) => t.lane === agent && t.status === "blocked");
  const inProgress = states.filter((t) => t.lane === agent && t.status === "in_progress");
  console.log(`Lane ${agent} không còn task ready (kể cả task mượn được).`);
  if (inProgress.length) console.log(`Đang làm: ${inProgress.map((t) => t.id).join(", ")}`);
  if (waiting.length) {
    console.log("Đang chờ:");
    for (const t of waiting) console.log(`  ${t.id} ← ${t.waitingOn.join(", ")}`);
  }
  process.exit(1);
}

const t = pick.task;
const flags = [t.ui && "ui", t.human && "human", t.stealable && "stealable"].filter(Boolean);
console.log(`${t.id}  ${t.title}`);
console.log(
  `  lane: ${t.lane}${pick.stolenFrom ? ` (mượn — ghi "Agent: ${agent} (mượn từ lane ${t.lane})")` : ""}`,
);
console.log(
  `  deps: ${t.deps.join(", ") || "—"} · est: ${t.est ?? "?"} · ver: ${t.ver ?? "?"}${flags.length ? ` · ${flags.join(", ")}` : ""}`,
);
if (t.touches.length) console.log(`  touches: ${t.touches.join(", ")}`);
console.log(`  mô tả + tiêu chí hoàn thành: docs/PLAN.md §9 (dòng "${t.id}")`);
