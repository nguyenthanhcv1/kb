import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ChangelogError,
  VI_END,
  VI_HEADING,
  VI_START,
  buildEntries,
  demoteHeadings,
  englishNotes,
  injectViNotes,
  parseChangelog,
  versionFromViFile,
} from "./changelog.mjs";
import { readViNotes } from "./build-changelog.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Định dạng thật của release-please (changelog-type mặc định).
const CHANGELOG = `# Changelog

## [0.2.0](https://github.com/o/kb/compare/v0.1.0...v0.2.0) (2026-11-02)


### Added

* **tree:** drag and drop pages in the sidebar ([#42](https://github.com/o/kb/issues/42)) ([1a2b3c4](https://github.com/o/kb/commit/1a2b3c4d5e))


### Fixed

* **search:** match words without diacritics ([#45](https://github.com/o/kb/issues/45)) ([abcdef0](https://github.com/o/kb/commit/abcdef0))

## 0.1.0 (2026-10-01)


### Added

* **web:** show the app version in the footer ([#7](https://github.com/o/kb/issues/7)) ([0011223](https://github.com/o/kb/commit/0011223))


### Miscellaneous Chores

* release 0.1.0 ([4455667](https://github.com/o/kb/commit/4455667))
`;

const VI_020 = `### Thêm

- Kéo thả trang trong thanh bên.

### Sửa lỗi

- Tìm kiếm không dấu.
`;

describe("parseChangelog", () => {
  it("reads versions and dates from release-please headings", () => {
    const { preamble, sections } = parseChangelog(CHANGELOG);
    assert.deepEqual(preamble, ["# Changelog", ""]);
    assert.deepEqual(
      sections.map((s) => [s.version, s.date]),
      [
        ["0.2.0", "2026-11-02"],
        ["0.1.0", "2026-10-01"],
      ],
    );
  });

  it("accepts Keep a Changelog headings and ignores headings in code fences", () => {
    const md = "## [1.0.0] - 2027-01-05\n\n```md\n## 9.9.9 (2000-01-01)\n```\n";
    const { sections } = parseChangelog(md);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].date, "2027-01-05");
  });
});

describe("injectViNotes", () => {
  it("appends a marked Tiếng Việt block at the end of the version section", () => {
    const { content, changed } = injectViNotes(CHANGELOG, "0.2.0", VI_020);
    assert.equal(changed, true);
    const expectedBlock = [
      "* **search:** match words without diacritics ([#45](https://github.com/o/kb/issues/45)) ([abcdef0](https://github.com/o/kb/commit/abcdef0))",
      "",
      VI_START,
      VI_HEADING,
      "",
      "#### Thêm",
      "",
      "- Kéo thả trang trong thanh bên.",
      "",
      "#### Sửa lỗi",
      "",
      "- Tìm kiếm không dấu.",
      VI_END,
      "",
      "## 0.1.0 (2026-10-01)",
    ].join("\n");
    assert.ok(content.includes(expectedBlock), content);
    // Version khác và phần tiếng Anh giữ nguyên.
    assert.equal(content.split(VI_START).length, 2);
    assert.ok(content.startsWith(CHANGELOG.slice(0, CHANGELOG.indexOf("\n\n## 0.1.0"))));
    assert.ok(content.endsWith(CHANGELOG.slice(CHANGELOG.indexOf("## 0.1.0"))));
  });

  it("is idempotent", () => {
    const once = injectViNotes(CHANGELOG, "0.2.0", VI_020).content;
    const twice = injectViNotes(once, "0.2.0", VI_020);
    assert.equal(twice.changed, false);
    assert.equal(twice.content, once);
  });

  it("replaces an older block when the Vietnamese notes change", () => {
    const once = injectViNotes(CHANGELOG, "0.2.0", VI_020).content;
    const { content, changed } = injectViNotes(once, "0.2.0", "- Chỉ một dòng.\n");
    assert.equal(changed, true);
    assert.equal(content.split(VI_START).length, 2);
    assert.ok(!content.includes("Kéo thả"));
    assert.ok(content.includes(`${VI_HEADING}\n\n- Chỉ một dòng.\n${VI_END}`));
  });

  it("handles several versions independently, including the last one", () => {
    const a = injectViNotes(CHANGELOG, "0.2.0", VI_020).content;
    const b = injectViNotes(a, "0.1.0", "### Thêm\n\n- Hiện phiên bản ở chân trang.\n").content;
    assert.equal(b.split(VI_START).length, 3);
    assert.ok(b.endsWith(`- Hiện phiên bản ở chân trang.\n${VI_END}\n`));
    assert.equal(injectViNotes(b, "0.2.0", VI_020).changed, false);
    assert.equal(
      injectViNotes(b, "0.1.0", "### Thêm\n\n- Hiện phiên bản ở chân trang.\n").changed,
      false,
    );
  });

  it("replaces an unmarked hand-written Tiếng Việt heading instead of duplicating it", () => {
    const manual = CHANGELOG.replace("\n## 0.1.0", `\n${VI_HEADING}\n\n- sửa tay\n\n## 0.1.0`);
    const { content } = injectViNotes(manual, "0.2.0", VI_020);
    assert.ok(!content.includes("sửa tay"));
    assert.equal(content.split(VI_HEADING).length, 2);
  });

  it("fails when the version section is missing", () => {
    assert.throws(
      () => injectViNotes(CHANGELOG, "0.3.0", VI_020),
      (e) => e instanceof ChangelogError && e.code === "VERSION_NOT_FOUND",
    );
  });

  it("fails on empty Vietnamese notes", () => {
    assert.throws(
      () => injectViNotes(CHANGELOG, "0.2.0", "  \n\n"),
      (e) => e instanceof ChangelogError && e.code === "VI_NOTES_EMPTY",
    );
  });

  it("normalises CRLF input", () => {
    const { content } = injectViNotes(CHANGELOG.replace(/\n/g, "\r\n"), "0.1.0", "- a\r\n");
    assert.ok(!content.includes("\r"));
  });
});

describe("demoteHeadings", () => {
  it("shifts the top heading level to 4 and leaves code blocks alone", () => {
    assert.equal(
      demoteHeadings("# A\n\n## B\n\n```\n# code\n```\n"),
      "#### A\n\n##### B\n\n```\n# code\n```\n",
    );
  });

  it("keeps notes that are already deep enough or have no headings", () => {
    assert.equal(demoteHeadings("#### A\n- x"), "#### A\n- x");
    assert.equal(demoteHeadings("- x"), "- x");
  });
});

describe("englishNotes / buildEntries", () => {
  it("drops hidden sections, commit hash links and the Vietnamese block", () => {
    const withVi = injectViNotes(CHANGELOG, "0.1.0", "- vi").content;
    const [, v010] = parseChangelog(withVi).sections;
    assert.equal(
      englishNotes(v010.body),
      "### Added\n\n* **web:** show the app version in the footer ([#7](https://github.com/o/kb/issues/7))",
    );
  });

  it("builds [{version, date, en, vi}] newest first, vi null when missing", () => {
    const entries = buildEntries(
      injectViNotes(CHANGELOG, "0.2.0", VI_020).content,
      new Map([
        ["0.2.0", `\n${VI_020}\n`],
        ["0.9.0", "- chưa phát hành"],
      ]),
    );
    assert.deepEqual(
      entries.map((e) => ({ ...e, en: e.en.split("\n")[0] })),
      [
        { version: "0.2.0", date: "2026-11-02", en: "### Added", vi: VI_020.trimEnd() },
        { version: "0.1.0", date: "2026-10-01", en: "### Added", vi: null },
      ],
    );
    assert.ok(entries[0].en.includes("### Fixed"));
    assert.ok(!entries[0].en.includes("Thêm"));
  });

  it("returns [] before the first release", () => {
    assert.deepEqual(buildEntries("", new Map()), []);
  });

  it("recognises only <semver>.md files in changelog/vi", () => {
    assert.equal(versionFromViFile("0.3.0.md"), "0.3.0");
    assert.equal(versionFromViFile("1.0.0-rc.1.md"), "1.0.0-rc.1");
    assert.equal(versionFromViFile("README.md"), null);
    assert.equal(versionFromViFile("_template.md"), null);
  });
});

describe("CLI", () => {
  const tmp = () => mkdtempSync(path.join(tmpdir(), "kb-changelog-"));

  it("build-changelog writes changelog.json from CHANGELOG.md + changelog/vi", () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "vi"));
    writeFileSync(path.join(dir, "CHANGELOG.md"), CHANGELOG);
    writeFileSync(path.join(dir, "vi", "0.1.0.md"), "- Phiên bản đầu tiên.\n");
    writeFileSync(path.join(dir, "vi", "README.md"), "# not a version\n");
    assert.deepEqual([...readViNotes(path.join(dir, "vi")).keys()], ["0.1.0"]);
    const out = path.join(dir, "gen", "changelog.json");
    execFileSync(process.execPath, [
      path.join(HERE, "build-changelog.mjs"),
      "--changelog",
      path.join(dir, "CHANGELOG.md"),
      "--vi-dir",
      path.join(dir, "vi"),
      "--out",
      out,
    ]);
    const json = JSON.parse(readFileSync(out, "utf8"));
    assert.deepEqual(
      json.map((/** @type {{version: string, vi: string | null}} */ e) => [e.version, e.vi]),
      [
        ["0.2.0", null],
        ["0.1.0", "- Phiên bản đầu tiên."],
      ],
    );
  });

  it("build-changelog writes [] when CHANGELOG.md does not exist yet", () => {
    const dir = tmp();
    const out = path.join(dir, "changelog.json");
    execFileSync(process.execPath, [
      path.join(HERE, "build-changelog.mjs"),
      "--changelog",
      path.join(dir, "CHANGELOG.md"),
      "--vi-dir",
      path.join(dir, "vi"),
      "--out",
      out,
    ]);
    assert.equal(readFileSync(out, "utf8"), "[]\n");
  });

  /** @param {string[]} args */
  const inject = (args) => {
    try {
      return {
        code: 0,
        out: execFileSync(process.execPath, [path.join(HERE, "inject-vi-changelog.mjs"), ...args], {
          encoding: "utf8",
          stdio: "pipe",
        }),
      };
    } catch (e) {
      const err = /** @type {{ status: number, stderr: string }} */ (e);
      return { code: err.status, out: err.stderr };
    }
  };

  it("inject-vi-changelog exits 1 when the Vietnamese notes are missing", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "CHANGELOG.md"), CHANGELOG);
    const r = inject([
      "--version",
      "0.2.0",
      "--changelog",
      path.join(dir, "CHANGELOG.md"),
      "--vi-dir",
      path.join(dir, "vi"),
    ]);
    assert.equal(r.code, 1);
    assert.match(r.out, /0\.2\.0\.md/);
    assert.equal(readFileSync(path.join(dir, "CHANGELOG.md"), "utf8"), CHANGELOG);
  });

  it("inject-vi-changelog edits CHANGELOG.md once, then reports no change", () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "vi"));
    writeFileSync(path.join(dir, "CHANGELOG.md"), CHANGELOG);
    writeFileSync(path.join(dir, "vi", "0.2.0.md"), VI_020);
    const args = [
      "--version",
      "0.2.0",
      "--changelog",
      path.join(dir, "CHANGELOG.md"),
      "--vi-dir",
      path.join(dir, "vi"),
    ];
    assert.equal(inject(args).code, 0);
    const first = readFileSync(path.join(dir, "CHANGELOG.md"), "utf8");
    assert.ok(first.includes(VI_START));
    const again = inject(args);
    assert.equal(again.code, 0);
    assert.match(again.out, /không đổi/);
    assert.equal(readFileSync(path.join(dir, "CHANGELOG.md"), "utf8"), first);
  });

  it("inject-vi-changelog exits 2 when CHANGELOG.md has no section for the version", () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "vi"));
    writeFileSync(path.join(dir, "CHANGELOG.md"), CHANGELOG);
    writeFileSync(path.join(dir, "vi", "0.3.0.md"), VI_020);
    const r = inject([
      "--version",
      "0.3.0",
      "--changelog",
      path.join(dir, "CHANGELOG.md"),
      "--vi-dir",
      path.join(dir, "vi"),
    ]);
    assert.equal(r.code, 2);
    assert.match(r.out, /0\.3\.0/);
  });
});
