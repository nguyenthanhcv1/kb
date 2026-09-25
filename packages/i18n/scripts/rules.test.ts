import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readCatalog, serialize, sortTree } from "./catalog";
import { checkCatalog, icuSignature } from "./rules";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Files = Record<string, unknown>;

/** Writes `{ "vi/common": {...} }` into a temp messages dir (canonical format unless a string is given). */
function fixture(files: Files): string {
  const dir = mkdtempSync(path.join(tmpdir(), "kb-i18n-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, `${name}.json`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, typeof content === "string" ? content : serialize(sortTree(content)));
  }
  return dir;
}

async function check(files: Files, errorCodes?: string[]) {
  const issues = checkCatalog(await readCatalog(fixture(files)), { errorCodes });
  return issues.map(
    (i) =>
      `${path.basename(path.dirname(i.file))}/${path.basename(i.file)}${i.key ? ` ${i.key}` : ""}: ${i.message}`,
  );
}

const good = {
  "vi/common": { actions: { save: "Lưu" }, results: "{count, plural, other {# kết quả}}" },
  "en/common": {
    actions: { save: "Save" },
    results: "{count, plural, one {# result} other {# results}}",
  },
};

describe("checkCatalog", () => {
  it("accepts a consistent catalog", async () => {
    expect(await check(good)).toEqual([]);
  });

  it("reports a key missing in en (acceptance: delete one en key → fail)", async () => {
    const issues = await check({
      ...good,
      "en/common": { results: "{count, plural, other {# results}}" },
    });
    expect(issues).toEqual(["en/common.json actions.save: missing key (present in vi)"]);
  });

  it("reports extra keys and missing files", async () => {
    const issues = await check({
      ...good,
      "en/common": { ...good["en/common"], extra: "Extra" },
      "vi/auth": { signIn: "Đăng nhập" },
    });
    expect(issues).toContain("en/common.json extra: extra key (absent in vi)");
    expect(issues).toContain("en/auth.json: missing file (exists for vi)");
  });

  it("reports ICU argument and tag mismatches and syntax errors", async () => {
    const issues = await check({
      "vi/common": { greet: "Chào {name}", link: "Xem <link>hướng dẫn</link>", bad: "Lỗi {" },
      "en/common": { greet: "Hello {user}", link: "See the guide", bad: "Error" },
    });
    expect(issues).toEqual([
      expect.stringMatching(/^vi\/common\.json bad: invalid ICU message/),
      expect.stringMatching(/^en\/common\.json greet: ICU arguments\/tags differ from vi/),
      expect.stringMatching(/^en\/common\.json link: ICU arguments\/tags differ from vi/),
    ]);
  });

  it("reports empty, TODO and non-string values", async () => {
    const issues = await check({
      "vi/common": { a: "", b: "TODO dịch", c: 3, d: {} },
      "en/common": { a: "", b: "TODO", c: 3, d: {} },
    });
    expect(issues.filter((i) => i.startsWith("vi/"))).toEqual([
      "vi/common.json a: empty value",
      "vi/common.json b: value still contains TODO",
      "vi/common.json c: value must be a string or object, got number",
      "vi/common.json d: empty object",
    ]);
  });

  it("reports unsorted keys, invalid JSON and unknown namespaces", async () => {
    const issues = await check({
      "vi/common": '{\n  "b": "B",\n  "a": "A"\n}\n',
      "en/common": { a: "A", b: "B" },
      "vi/nav": "{ nope",
      "en/nav": { x: "X" },
      "vi/random": { x: "X" },
      "en/random": { x: "X" },
    });
    expect(issues).toContain(
      "vi/common.json: keys are not sorted / not canonically formatted (run `pnpm i18n:sort`)",
    );
    expect(issues).toContainEqual(expect.stringMatching(/^vi\/nav\.json: invalid JSON/));
    expect(issues).toContainEqual(
      expect.stringMatching(/^vi\/random\.json: unknown namespace "random"/),
    );
  });

  it("requires a translation for every error code", async () => {
    const files = {
      "vi/errors": { PAGE_NOT_FOUND: "Không tìm thấy trang" },
      "en/errors": { PAGE_NOT_FOUND: "Page not found" },
    };
    expect(await check(files, ["PAGE_NOT_FOUND"])).toEqual([]);
    expect(await check(files, ["PAGE_NOT_FOUND", "FORBIDDEN"])).toEqual([
      "vi/errors.json FORBIDDEN: error code from packages/shared/src/errors.ts has no translation",
    ]);
  });
});

describe("icuSignature", () => {
  it("collects argument names, kinds and tags across nested messages", () => {
    expect(
      icuSignature(
        "{n, plural, one {<b>{name}</b> và # tệp} other {{when, date, short}}} {kind, select, a {A} other {B}}",
      ),
    ).toEqual(["arg:kind:select", "arg:n:plural", "arg:name:string", "arg:when:date", "tag:b"]);
  });
});

describe("CLI", () => {
  const run = (script: string, args: string[]) =>
    execFileSync(
      process.execPath,
      ["--import", "tsx", path.join(import.meta.dirname, script), ...args],
      {
        encoding: "utf8",
        stdio: "pipe",
      },
    );

  it("i18n:check exits 1 with a report, 0 when clean", () => {
    expect(run("check.ts", ["--messages", fixture(good)])).toMatch(/i18n:check OK \(2 file/);
    const broken = fixture({
      ...good,
      "en/common": { results: "{count, plural, other {# results}}" },
    });
    expect(() => run("check.ts", ["--messages", broken])).toThrow(/actions\.save: missing key/);
  });

  it("i18n:sort rewrites files canonically", () => {
    const dir = fixture({
      "vi/common": '{"b":{"z":"Z","a":"A"},"a":"A"}',
      "en/common": '{"a":"A","b":{"a":"A","z":"Z"}}',
    });
    run("sort.ts", ["--messages", dir]);
    expect(readFileSync(path.join(dir, "vi/common.json"), "utf8")).toBe(
      '{\n  "a": "A",\n  "b": {\n    "a": "A",\n    "z": "Z"\n  }\n}\n',
    );
  });
});
