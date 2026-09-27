import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTasks } from "./lib.mjs";
import { checkScope, parseNameStatus, parsePrBody } from "./scope.mjs";

const taskFile = parseTasks(`
tasks:
  - { id: T1.4a, title: server, deps: [] }
  - { id: T1.4b, title: ui, deps: [T1.4a], ui: true }
  - { id: T7.6,  title: go-live, deps: [], manual: true }
`);

/** @param {string} agent @param {string} task */
const body = (agent, task) =>
  `<!-- Tiêu đề PR = … -->\n\nAgent: ${agent} <!-- claude | codex | … -->\nTask: ${task} <!-- T1.1 -->\n\n## Tóm tắt\n`;

/** @param {...string} paths */
const mod = (...paths) => paths.map((path) => ({ status: "M", path }));

/**
 * @param {string} agent @param {string} task @param {{status: string, path: string}[]} files
 * @param {{ title?: string, done?: Set<string> }} [opts]
 */
const run = (agent, task, files, opts = {}) =>
  checkScope({
    taskFile,
    body: body(agent, task),
    title: opts.title ?? `feat: x [${task}]`,
    files,
    done: opts.done,
  });

describe("parsePrBody", () => {
  it("bỏ comment template, đọc agent (tên tự do) và task", () => {
    assert.deepEqual(parsePrBody(body("claude-2", "T1.4b")), { agent: "claude-2", task: "T1.4b" });
    assert.deepEqual(parsePrBody(body("`codex`", "T1.4a — contract")), {
      agent: "codex",
      task: "T1.4a",
    });
  });

  it("template chưa điền → không có agent/task", () => {
    const empty = "Agent: <!-- claude | codex | human -->\nTask: <!-- T1.1 — xem … -->\n";
    assert.deepEqual(parsePrBody(empty), { agent: null, task: null });
  });
});

describe("checkScope", () => {
  it("agent nào cũng làm được task nào, sửa file nào cũng được", () => {
    for (const agent of ["claude", "codex", "claude-1", "codex-1"]) {
      const r = run(
        agent,
        "T1.4b",
        mod("apps/web/src/components/space/list.tsx", "supabase/x.sql"),
      );
      assert.deepEqual(r.errors, [], agent);
    }
  });

  it("thiếu Agent/Task, task lạ, tiêu đề thiếu [Txx] → lỗi", () => {
    assert.match(run("", "T1.4a", []).errors[0], /Agent/);
    assert.match(run("claude", "", []).errors[0], /Task/);
    assert.match(run("claude", "T9.9", []).errors[0], /không có/);
    assert.match(run("claude", "T1.4a", [], { title: "feat: x" }).errors[0], /\[T1\.4a\]/);
  });

  it("một PR chỉ một task; PR contract hợp lệ", () => {
    assert.match(
      run("claude", "T1.4a", [], { title: "feat: x [T1.4a] [T1.4b]" }).errors[0],
      /Một PR = một task/,
    );
    assert.deepEqual(run("codex", "T1.4a", [], { title: "feat: x [T1.4a-contract]" }).errors, []);
  });

  it("deps chưa merge vào nhánh gốc → lỗi", () => {
    assert.match(run("claude", "T1.4b", [], { done: new Set() }).errors[0], /T1\.4a chưa merge/);
    assert.deepEqual(run("claude", "T1.4b", [], { done: new Set(["T1.4a"]) }).errors, []);
  });

  it("task manual phải do người làm", () => {
    assert.match(run("claude", "T7.6", []).errors[0], /manual/);
  });

  it("CHANGELOG.md, manifest → lỗi; human và bot được bỏ qua", () => {
    assert.match(run("claude", "T1.4a", mod("CHANGELOG.md")).errors[0], /release-please/);
    const human = checkScope({ taskFile, body: "Agent: human\n", title: "docs: x", files: [] });
    assert.deepEqual(human.errors, []);
    const bot = checkScope({
      taskFile,
      body: "",
      title: "chore(main): release 0.2.0",
      files: mod("CHANGELOG.md"),
      authorIsBot: true,
    });
    assert.deepEqual(bot.errors, []);
  });
});

describe("parseNameStatus", () => {
  it("đổi tên tính cả đường dẫn cũ (D) và mới (A)", () => {
    const raw = [
      "M",
      "a.ts",
      "R087",
      "old/x.ts",
      "new/x.ts",
      "A",
      "b.ts",
      "C100",
      "c.ts",
      "d.ts",
      "",
    ].join("\0");
    assert.deepEqual(parseNameStatus(raw), [
      { status: "M", path: "a.ts" },
      { status: "D", path: "old/x.ts" },
      { status: "A", path: "new/x.ts" },
      { status: "A", path: "b.ts" },
      { status: "A", path: "d.ts" },
    ]);
  });
});
