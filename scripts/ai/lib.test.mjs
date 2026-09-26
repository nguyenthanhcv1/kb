import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  computeStates,
  dependentCounts,
  doneIdsFromSubjects,
  globToRegExp,
  inProgressIds,
  isUiFile,
  loadTasks,
  ownerOf,
  parseTasks,
  pickNext,
} from "./lib.mjs";

const FIXTURE = `
lanes:
  claude-1: { tool: claude-code, name: A, owns: ["apps/web/src/components/ui/**", packages/editor/src/extract/**] }
  claude-2: { tool: claude-code, name: B, owns: ["scripts/**", "apps/web/src/app/(app)/**"] }
  codex-1:  { tool: codex, name: C, owns: ["supabase/**", scripts/seed-perf.ts] }
  human:    { tool: human, name: H, owns: [docs/ai/**] }
tasks:
  - { id: T1,  lane: claude-2, title: t1, deps: [] }
  - { id: T2,  lane: claude-2, title: t2, deps: [T1] }
  - { id: T3,  lane: codex-1,  title: t3, deps: [] }
  - { id: T4a, lane: codex-1,  title: t4a, deps: [T3], stealable: true }
  - { id: T4b, lane: claude-1, title: t4b, deps: [T4a], ui: true }
  - { id: T5,  lane: claude-1, title: t5, deps: [], stealable: true }
  - { id: T6,  lane: claude-1, title: t6, deps: [], ui: true, stealable: true }
  - { id: T7,  lane: codex-1,  title: t7, deps: [], stealable: true }
  - { id: T8,  lane: codex-1,  title: t8, deps: [T7] }
`;

describe("parseTasks", () => {
  it("đọc được docs/ai/tasks.yaml thật", () => {
    const path = fileURLToPath(new URL("../../docs/ai/tasks.yaml", import.meta.url));
    const { lanes, tasks } = loadTasks(path);
    assert.ok(lanes["claude-2"].owns.includes("scripts/**"));
    assert.ok(tasks.find((t) => t.id === "T0.11"));
  });

  it("báo lỗi dep không tồn tại và id trùng", () => {
    assert.throws(
      () => parseTasks(`lanes: {a: {owns: []}}\ntasks: [{id: T1, lane: a, deps: [T9]}]`),
      /T9/,
    );
    assert.throws(
      () => parseTasks(`lanes: {a: {owns: []}}\ntasks: [{id: T1, lane: a}, {id: T1, lane: a}]`),
      /trùng/,
    );
  });
});

describe("glob và chủ sở hữu", () => {
  it("** khớp nhiều cấp, * chỉ một cấp, ngoặc là literal", () => {
    assert.ok(globToRegExp("scripts/**").test("scripts/ai/next.mjs"));
    assert.ok(
      globToRegExp("packages/i18n/messages/*/nav.json").test("packages/i18n/messages/vi/nav.json"),
    );
    assert.ok(
      !globToRegExp("packages/i18n/messages/*/nav.json").test(
        "packages/i18n/messages/a/b/nav.json",
      ),
    );
    assert.ok(
      globToRegExp("apps/web/src/app/(app)/**").test("apps/web/src/app/(app)/spaces/page.tsx"),
    );
    assert.ok(!globToRegExp("apps/web/src/app/(app)/**").test("apps/web/src/app/app/page.tsx"));
    assert.ok(globToRegExp("**/*.css").test("globals.css"));
    assert.ok(globToRegExp("**/*.css").test("apps/web/src/x.css"));
  });

  it("glob cụ thể hơn thắng", () => {
    const { lanes } = parseTasks(FIXTURE);
    assert.equal(ownerOf("scripts/seed-perf.ts", lanes), "codex-1");
    assert.equal(ownerOf("scripts/ai/next.mjs", lanes), "claude-2");
    assert.equal(ownerOf("README.md", lanes), null);
  });

  it("phân loại file UI theo WORKFLOW §3", () => {
    for (const f of [
      "apps/web/src/components/space/list.tsx",
      "apps/web/src/app/(app)/page.tsx",
      "apps/web/src/app/layout.tsx",
      "apps/web/src/app/globals.css",
      "packages/i18n/messages/vi/space.json",
      "packages/editor/src/extensions/table.ts",
      "packages/emails/src/invite.tsx",
      "docs/user-guide/vi/index.md",
      "changelog/vi/0.1.0.md",
    ]) {
      assert.ok(isUiFile(f), f);
    }
    for (const f of [
      "apps/web/src/app/api/health/route.ts",
      "apps/web/src/app/auth/callback/route.ts",
      "apps/web/src/server/spaces/index.ts",
      "packages/i18n/messages/en/errors.json",
      "packages/i18n/messages/vi/audit.json",
      "packages/editor/src/extract/text.ts",
      "supabase/migrations/1_x.sql",
    ]) {
      assert.ok(!isUiFile(f), f);
    }
  });
});

describe("trạng thái task", () => {
  it("done từ [Txx] trên main, bỏ qua [Txx-contract]", () => {
    const done = doneIdsFromSubjects([
      "feat(db): add core schema and RLS [T1.1] (#7)",
      "feat(web): add Space contract [T1.4a-contract] (#9)",
      "chore(infra): scaffold [T0.1a] (#3)",
    ]);
    assert.deepEqual([...done].sort(), ["T0.1a", "T1.1"]);
  });

  it("in_progress từ nhánh <agent>/<id>-slug và PR đang mở (kể cả contract)", () => {
    const ids = inProgressIds(
      ["codex-1/T1.4a-space-server", "claude/some-session", "main", "codex-1/T1.1-core-schema"],
      ["feat(ci): agent tooling [T0.11]", "feat(web): contract [T2.2-contract]", "wip"],
    );
    assert.deepEqual([...ids].sort(), ["T0.11", "T1.1", "T1.4a", "T2.2"]);
  });

  it("done thắng in_progress (nhánh chưa xoá sau merge); deps chưa xong → blocked", () => {
    const { tasks } = parseTasks(FIXTURE);
    const states = computeStates(tasks, new Set(["T1"]), new Set(["T1", "T3"]));
    const by = Object.fromEntries(states.map((s) => [s.id, s]));
    assert.equal(by.T1.status, "done");
    assert.equal(by.T2.status, "ready");
    assert.equal(by.T3.status, "in_progress");
    assert.equal(by.T4a.status, "blocked");
    assert.deepEqual(by.T4a.waitingOn, ["T3"]);
  });

  it("đếm task phụ thuộc gián tiếp", () => {
    const counts = dependentCounts(parseTasks(FIXTURE).tasks);
    assert.equal(counts.get("T3"), 2); // T4a, T4b
    assert.equal(counts.get("T4b"), 0);
  });
});

describe("pickNext", () => {
  const { tasks } = parseTasks(FIXTURE);

  it("lấy task ready đầu tiên của lane theo thứ tự file", () => {
    const states = computeStates(tasks, new Set(), new Set());
    assert.equal(pickNext(states, "claude-2")?.task.id, "T1");
    assert.equal(pickNext(states, "codex-1")?.task.id, "T3");
    assert.equal(pickNext(states, "claude-1")?.task.id, "T5");
  });

  it("lane hết việc → mượn task stealable không-UI, ưu tiên đường găng", () => {
    // claude-2: T1 đang làm, T2 chờ T1 → mượn. T5 (claude-1) và T7 (codex-1) cùng stealable;
    // T7 có T8 phụ thuộc nên được ưu tiên.
    const states = computeStates(tasks, new Set(), new Set(["T1"]));
    const pick = pickNext(states, "claude-2");
    assert.equal(pick?.task.id, "T7");
    assert.equal(pick?.stolenFrom, "codex-1");
  });

  it("Codex không bao giờ mượn task UI; Claude mượn UI của Claude chỉ khi cho phép", () => {
    const states = computeStates(tasks, new Set(["T1", "T2"]), new Set(["T3", "T5", "T7"]));
    assert.equal(pickNext(states, "codex-1"), null);
    assert.equal(pickNext(states, "claude-2"), null);
    assert.equal(pickNext(states, "claude-2", { allowUiSteal: true })?.task.id, "T6");
  });
});
