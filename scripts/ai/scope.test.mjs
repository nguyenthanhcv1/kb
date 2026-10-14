import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTasks } from "./lib.mjs";
import { checkScope, checkViNotes, parseNameStatus, parsePrBody } from "./scope.mjs";

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

  it("Task: none = việc theo yêu cầu: không cần task, tiêu đề không được có [Txx]", () => {
    assert.equal(parsePrBody(body("claude", "none")).task, "none");
    assert.equal(parsePrBody(body("claude", "- (sửa lỗi theo yêu cầu)")).task, "none");
    assert.deepEqual(run("claude", "none", [], { title: "fix(web): x" }).errors, []);
    assert.match(
      run("claude", "none", [], { title: "fix(web): x [T1.4a]" }).errors[0],
      /Task: none/,
    );
    assert.match(
      run("claude", "none", mod("CHANGELOG.md"), { title: "fix: x" }).errors[0],
      /release-please/,
    );
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

describe("checkViNotes", () => {
  const add = (/** @type {string[]} */ ...paths) => paths.map((path) => ({ status: "A", path }));
  /** @param {string} title @param {{status: string, path: string}[]} files @param {string} [agent] */
  const vi = (title, files, agent = "claude") =>
    checkViNotes({ body: body(agent, "none"), title, files });

  it("feat/fix/perf/revert/security không có ghi chú → lỗi", () => {
    for (const title of [
      "feat(web): share pages",
      "fix: x",
      "perf(search)!: faster",
      "revert: y",
      "security: z",
    ]) {
      const r = vi(title, mod("apps/web/src/x.tsx"));
      assert.equal(r.errors.length, 1, title);
      assert.match(r.errors[0], /changelog\/vi\/unreleased/);
    }
  });

  it("có changelog/vi/unreleased/<tên>.md (thêm hoặc sửa) → đạt", () => {
    assert.deepEqual(vi("feat: x", add("changelog/vi/unreleased/share.md")).errors, []);
    assert.deepEqual(vi("fix: x", mod("changelog/vi/unreleased/share.md")).errors, []);
  });

  it("xoá ghi chú, README, file mẫu hay thư mục khác không tính", () => {
    for (const files of [
      [{ status: "D", path: "changelog/vi/unreleased/share.md" }],
      add("changelog/vi/unreleased/README.md"),
      add("changelog/vi/unreleased/_template.md"),
      add("changelog/vi/unreleased/sub/x.md"),
      add("changelog/vi/1.3.0.md"),
    ]) {
      assert.equal(vi("feat: x", files).errors.length, 1, files[0].path);
    }
  });

  it("type ẩn (chore, docs, ci…) không cần ghi chú; bot bỏ qua; human chỉ cảnh báo", () => {
    for (const title of ["chore: x", "docs(release): x", "ci: x", "refactor: x", "test: x"]) {
      assert.deepEqual(vi(title, []).errors, [], title);
    }
    const bot = checkViNotes({ body: "", title: "fix: x", files: [], authorIsBot: true });
    assert.deepEqual(bot, { errors: [], warnings: [], notes: [] });
    const human = vi("feat: x", [], "human");
    assert.deepEqual(human.errors, []);
    assert.equal(human.warnings.length, 1);
  });
});
