import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTasks } from "./lib.mjs";
import { checkScope, parseNameStatus, parsePrBody } from "./scope.mjs";

const taskFile = parseTasks(`
lanes:
  claude-1: { owns: ["apps/web/src/components/ui/**", "apps/web/src/components/layout/**", packages/editor/src/extract/**] }
  claude-2: { owns: ["scripts/**", "apps/web/src/components/space/**", ".github/**", package.json] }
  codex-1:  { owns: ["supabase/**", "apps/web/src/server/**", scripts/seed-perf.ts, "packages/i18n/messages/*/errors.json"] }
  human:    { owns: [docs/ai/**] }
tasks:
  - { id: T0.11, lane: claude-2, title: tooling, deps: [] }
  - { id: T1.4a, lane: codex-1, title: server, deps: [] }
  - { id: T1.4b, lane: claude-2, title: ui, deps: [T1.4a], ui: true, touches: [apps/web/src/components/layout/app-version.tsx] }
  - { id: T3.3b, lane: claude-1, title: extract, deps: [], stealable: true }
  - { id: T3.2,  lane: claude-1, title: editor ui, deps: [], ui: true }
  - { id: T4.4a, lane: claude-1, title: paste, deps: [] }
  - { id: T4.5,  lane: codex-1, title: csv, deps: [], stealable: true }
`);

/** @param {string} agent @param {string} task */
const body = (agent, task) =>
  `<!-- Tiêu đề PR = … -->\n\nAgent: ${agent} <!-- claude-1 | … -->\nTask: ${task} <!-- T1.1 -->\n\n## Tóm tắt\n`;

/** @param {...string} paths */
const mod = (...paths) => paths.map((path) => ({ status: "M", path }));

/**
 * @param {string} agent @param {string} task @param {{status: string, path: string}[]} files
 * @param {string} [title]
 */
const run = (agent, task, files, title = `feat: x [${task}]`) =>
  checkScope({ taskFile, body: body(agent, task), title, files });

describe("parsePrBody", () => {
  it("bỏ comment template, đọc agent/mượn/task", () => {
    assert.deepEqual(parsePrBody(body("claude-2 (mượn từ lane codex-1)", "T4.5")), {
      agent: "claude-2",
      borrowedFrom: "codex-1",
      task: "T4.5",
    });
    assert.deepEqual(parsePrBody(body("`codex-1`", "T1.4a — contract")), {
      agent: "codex-1",
      borrowedFrom: null,
      task: "T1.4a",
    });
  });

  it("template chưa điền → không có agent/task", () => {
    const empty =
      "Agent: <!-- claude-1 | claude-2 | codex-1 | human -->\nTask: <!-- T1.1 — xem … -->\n";
    assert.deepEqual(parsePrBody(empty), { agent: null, borrowedFrom: null, task: null });
  });
});

describe("checkScope", () => {
  it("PR đúng lane → OK", () => {
    const r = run("claude-2", "T0.11", [
      ...mod("scripts/ai/next.mjs", ".github/workflows/agent-scope.yml", "package.json"),
      { status: "M", path: "pnpm-lock.yaml" },
    ]);
    assert.deepEqual(r.errors, []);
  });

  it("codex-1 sửa components/** → đỏ, kể cả khi task đúng lane (tiêu chí T0.11)", () => {
    const r = run(
      "codex-1",
      "T1.4a",
      mod("apps/web/src/server/spaces/index.ts", "apps/web/src/components/space/list.tsx"),
    );
    assert.equal(r.errors.length, 2); // file UI + ngoài vùng lane
    assert.match(r.errors[0], /Codex không được sửa/);
  });

  it("codex-1 được thêm key errors.json", () => {
    const r = run("codex-1", "T1.4a", mod("packages/i18n/messages/vi/errors.json"));
    assert.deepEqual(r.errors, []);
  });

  it("file thuộc lane khác → đỏ; glob cụ thể hơn thắng", () => {
    const r = run("claude-2", "T0.11", mod("scripts/seed-perf.ts", "supabase/migrations/1.sql"));
    assert.equal(r.errors.length, 2);
    assert.match(r.errors[0], /thuộc lane codex-1/);
  });

  it("touches của task mở rộng vùng", () => {
    const r = run("claude-2", "T1.4b", mod("apps/web/src/components/layout/app-version.tsx"));
    assert.deepEqual(r.errors, []);
  });

  it("task UI: được thêm mock.ts và component shadcn mới, không được sửa component có sẵn", () => {
    const ok = run("claude-2", "T1.4b", [
      { status: "A", path: "apps/web/src/server/spaces/mock.ts" },
      { status: "A", path: "apps/web/src/components/ui/tabs.tsx" },
    ]);
    assert.deepEqual(ok.errors, []);
    const bad = run("claude-2", "T1.4b", mod("apps/web/src/components/ui/button.tsx"));
    assert.equal(bad.errors.length, 1);
    const notUi = run("claude-2", "T0.11", [
      { status: "A", path: "apps/web/src/server/spaces/mock.ts" },
    ]);
    assert.equal(notUi.errors.length, 1);
  });

  it("file không lane nào sở hữu → cảnh báo, không đỏ; root config thuộc claude-2", () => {
    const r = run("claude-1", "T3.3b", mod("packages/editor/package.json"));
    assert.deepEqual(r.errors, []);
    assert.equal(r.warnings.length, 1);
    const cfg = run("claude-1", "T3.3b", mod("prettier.config.mjs"));
    assert.match(cfg.errors[0], /thuộc lane claude-2/);
  });

  it("CHANGELOG.md và manifest release-please bị cấm", () => {
    const r = run("claude-2", "T0.11", mod("CHANGELOG.md", ".release-please-manifest.json"));
    assert.equal(r.errors.length, 2);
  });

  it("làm task lane khác mà không ghi mượn → đỏ", () => {
    const r = run("claude-2", "T3.3b", mod("packages/editor/src/extract/text.ts"));
    assert.match(r.errors[0], /mượn từ lane claude-1/);
  });

  it("mượn hợp lệ: vùng là owns của lane gốc", () => {
    const r = run(
      "codex-1 (mượn từ lane claude-1)",
      "T3.3b",
      mod("packages/editor/src/extract/text.ts"),
    );
    assert.deepEqual(r.errors, []);
    const c = run("claude-2 (mượn từ lane codex-1)", "T4.5", mod("apps/web/src/server/x.ts"));
    assert.deepEqual(c.errors, []);
  });

  it("mượn không hợp lệ: task không stealable, Codex mượn UI, sai lane gốc", () => {
    assert.match(run("codex-1 (mượn từ lane claude-1)", "T4.4a", []).errors[0], /stealable/);
    assert.ok(run("codex-1 (mượn từ lane claude-1)", "T3.2", []).errors.length > 0);
    assert.match(
      run("codex-1 (mượn từ lane claude-2)", "T3.3b", []).errors[0],
      /thuộc lane claude-1/,
    );
  });

  it("Claude mượn của Claude → cảnh báo cần người đồng ý", () => {
    const r = run("claude-2 (mượn từ lane claude-1)", "T3.2", []);
    assert.deepEqual(r.errors, []);
    assert.match(r.warnings[0], /người đồng ý/);
  });

  it("tiêu đề thiếu mã task, task lạ, thiếu Agent/Task", () => {
    assert.match(run("claude-2", "T0.11", [], "feat: x").errors[0], /\[T0\.11\]/);
    assert.equal(run("claude-2", "T0.11", [], "feat: x [T0.11-contract]").errors.length, 0);
    assert.match(run("claude-2", "T9.9", []).errors[0], /không có trong/);
    assert.equal(checkScope({ taskFile, body: "", title: "", files: [] }).errors.length, 1);
    assert.match(
      checkScope({ taskFile, body: "Agent: claude-2", title: "", files: [] }).errors[0],
      /Task:/,
    );
  });

  it("Agent: human và PR của bot → bỏ qua", () => {
    assert.deepEqual(
      run("human", "", mod("AGENTS.md", "apps/web/src/components/ui/button.tsx")).errors,
      [],
    );
    const bot = checkScope({
      taskFile,
      body: "",
      title: "chore(main): release 0.1.0",
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
