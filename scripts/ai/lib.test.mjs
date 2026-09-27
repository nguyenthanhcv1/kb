import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  computeStates,
  doneIdsFromSubjects,
  inProgressIds,
  loadTasks,
  parseTasks,
  pickNext,
} from "./lib.mjs";

const FIXTURE = `
tasks:
  - { id: T1,  title: t1, deps: [] }
  - { id: T2,  title: t2, deps: [T1] }
  - { id: T3,  title: t3, deps: [] }
  - { id: T4a, title: t4a, deps: [T3] }
  - { id: T4b, title: t4b, deps: [T4a], ui: true }
  - { id: T5,  title: t5, deps: [], human: true }
  - { id: T6,  title: t6, deps: [], manual: true }
  - { id: T7,  title: t7, deps: [] }
`;

describe("parseTasks", () => {
  it("đọc được docs/ai/tasks.yaml thật (mỗi task đứng sau deps của nó)", () => {
    const path = fileURLToPath(new URL("../../docs/ai/tasks.yaml", import.meta.url));
    const { tasks } = loadTasks(path);
    assert.ok(tasks.find((t) => t.id === "T0.11"));
    assert.ok(tasks.find((t) => t.id === "T7.6")?.manual);
  });

  it("báo lỗi dep không tồn tại, id trùng, dep đứng sau task", () => {
    assert.throws(() => parseTasks(`tasks: [{id: T1, deps: [T9]}]`), /T9/);
    assert.throws(() => parseTasks(`tasks: [{id: T1}, {id: T1}]`), /trùng/);
    assert.throws(
      () => parseTasks(`tasks: [{id: T2, deps: [T1]}, {id: T1}]`),
      /T2 phải đứng sau task phụ thuộc T1/,
    );
  });

  it("vẫn đọc được định dạng cũ có lane (bỏ qua lane; lane human = manual)", () => {
    const { tasks } = parseTasks(
      `lanes: {a: {owns: []}}\ntasks: [{id: T1, lane: a}, {id: T2, lane: human, deps: [T1]}]`,
    );
    assert.deepEqual(
      tasks.map((t) => [t.id, t.manual]),
      [
        ["T1", false],
        ["T2", true],
      ],
    );
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
      ["codex-1/T1.4a-space-server", "claude/some-session", "main", "codex/T1.1-core-schema"],
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
});

describe("pickNext", () => {
  const { tasks } = parseTasks(FIXTURE);

  it("lấy task ready đầu tiên theo thứ tự file, cho mọi agent", () => {
    const states = computeStates(tasks, new Set(), new Set());
    assert.equal(pickNext(states)?.id, "T1");
  });

  it("bỏ qua task đang làm, task bị chặn và task trong skip", () => {
    const states = computeStates(tasks, new Set(), new Set(["T1"]));
    assert.equal(pickNext(states)?.id, "T3"); // T2 chờ T1
    assert.equal(pickNext(states, { skip: ["T3"] })?.id, "T5");
  });

  it("không bao giờ chọn task manual", () => {
    const states = computeStates(
      tasks,
      new Set(["T1", "T2", "T3", "T4a", "T4b"]),
      new Set(["T5", "T7"]),
    );
    assert.equal(pickNext(states), null);
  });
});
