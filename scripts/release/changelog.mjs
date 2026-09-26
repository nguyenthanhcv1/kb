// Đọc/sửa CHANGELOG.md do release-please sinh (docs/PLAN.md §6.3). Hàm thuần — không đụng file,
// để test bằng `node --test`. CLI: inject-vi-changelog.mjs, build-changelog.mjs.

/** Tiêu đề khối tiếng Việt trong mỗi version của CHANGELOG.md. */
export const VI_HEADING = "### Tiếng Việt";
/** Mốc bao khối tiếng Việt — nhờ nó mà chèn lại (idempotent) không nhân đôi nội dung. */
export const VI_START = "<!-- vi-notes:start -->";
export const VI_END = "<!-- vi-notes:end -->";

/**
 * Section release-please có thể sinh nhưng không dành cho người dùng (type ẩn trong
 * release-please-config.json, hoặc mặc định của release-please nếu ai đó bỏ `hidden`).
 * Bỏ khỏi trang What's new.
 */
export const HIDDEN_SECTIONS = new Set([
  "Miscellaneous Chores",
  "Documentation",
  "Tests",
  "Continuous Integration",
  "Build System",
  "Styles",
  "Code Refactoring",
]);

/** Dòng tiêu đề version: `## [0.3.0](…compare…) (2026-11-02)`, `## 0.3.0 (2026-11-02)`, `## [0.3.0] - 2026-11-02`. */
const VERSION_HEADING = /^## \[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?/;
const DATE = /\b(\d{4}-\d{2}-\d{2})\b/;
const SEMVER_FILE = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.md$/;

export class ChangelogError extends Error {
  /**
   * @param {"VERSION_NOT_FOUND" | "VI_NOTES_EMPTY"} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * @typedef {{ version: string, date: string | null, heading: string, body: string[] }} Section
 *   `body`: các dòng sau tiêu đề, tới trước tiêu đề version kế tiếp.
 */

/**
 * Tách CHANGELOG.md thành phần đầu (tiêu đề file) và các section version, giữ nguyên thứ tự.
 * @param {string} markdown
 * @returns {{ preamble: string[], sections: Section[] }}
 */
export function parseChangelog(markdown) {
  const lines = normalizeNewlines(markdown).split("\n");
  /** @type {string[]} */
  const preamble = [];
  /** @type {Section[]} */
  const sections = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = inFence ? null : line.match(VERSION_HEADING);
    if (m) {
      const rest = line.slice(m[0].length);
      sections.push({
        version: m[1],
        date: rest.match(DATE)?.[1] ?? null,
        heading: line,
        body: [],
      });
    } else if (sections.length) {
      sections[sections.length - 1].body.push(line);
    } else {
      preamble.push(line);
    }
  }
  return { preamble, sections };
}

/**
 * @param {{ preamble: string[], sections: Section[] }} parsed
 * @returns {string}
 */
export function serializeChangelog({ preamble, sections }) {
  return [...preamble, ...sections.flatMap((s) => [s.heading, ...s.body])].join("\n");
}

/**
 * Bỏ khối tiếng Việt khỏi thân một version: khối có mốc `vi-notes`, và (phòng khi sửa tay)
 * tiêu đề `### Tiếng Việt` không có mốc — tính tới hết section.
 * @param {string[]} body
 * @returns {string[]}
 */
export function stripViBlock(body) {
  /** @type {string[]} */
  const out = [];
  let inMarked = false;
  let inUnmarked = false;
  for (const line of body) {
    const t = line.trim();
    if (inMarked) {
      if (t === VI_END) inMarked = false;
      continue;
    }
    if (t === VI_START) {
      inMarked = true;
      continue;
    }
    if (t === VI_HEADING) inUnmarked = true;
    if (!inUnmarked) out.push(line);
  }
  return out;
}

/**
 * Hạ cấp tiêu đề để tiêu đề lớn nhất trong ghi chú tiếng Việt là `####` (nằm dưới `### Tiếng Việt`).
 * Bỏ qua code block.
 * @param {string} markdown
 * @param {number} [minLevel]
 */
export function demoteHeadings(markdown, minLevel = 4) {
  const lines = markdown.split("\n");
  let inFence = false;
  let top = Infinity;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence && line.match(/^(#{1,6})\s/);
    if (m) top = Math.min(top, m[1].length);
  }
  if (top === Infinity || top >= minLevel) return markdown;
  const shift = minLevel - top;
  inFence = false;
  return lines
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      if (inFence) return line;
      return line.replace(/^(#{1,6})(?=\s)/, (h) => "#".repeat(Math.min(6, h.length + shift)));
    })
    .join("\n");
}

/** @param {string[]} lines */
function trimBlankEnds(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end);
}

/**
 * Chèn (hoặc thay) khối `### Tiếng Việt` vào cuối section của `version`. Idempotent: chạy lại
 * với cùng nội dung → `changed: false`.
 * @param {string} changelog nội dung CHANGELOG.md
 * @param {string} version vd `0.3.0`
 * @param {string} viMarkdown nội dung changelog/vi/<version>.md
 * @returns {{ content: string, changed: boolean }}
 * @throws {ChangelogError} VERSION_NOT_FOUND, VI_NOTES_EMPTY
 */
export function injectViNotes(changelog, version, viMarkdown) {
  const notes = trimBlankEnds(normalizeNewlines(viMarkdown).split("\n"));
  if (notes.length === 0) {
    throw new ChangelogError("VI_NOTES_EMPTY", `changelog/vi/${version}.md đang trống.`);
  }
  const original = normalizeNewlines(changelog);
  const parsed = parseChangelog(original);
  const section = parsed.sections.find((s) => s.version === version);
  if (!section) {
    throw new ChangelogError(
      "VERSION_NOT_FOUND",
      `CHANGELOG.md không có section cho version ${version}.`,
    );
  }
  // Giữ nguyên phần tiếng Anh (kể cả dòng trống đầu) để diff của Release PR chỉ là khối tiếng Việt.
  const en = stripViBlock(section.body);
  while (en.length && en[en.length - 1].trim() === "") en.pop();
  section.body = [
    ...en,
    "",
    VI_START,
    VI_HEADING,
    "",
    ...demoteHeadings(notes.join("\n")).split("\n"),
    VI_END,
    "",
  ];
  const content = serializeChangelog(parsed);
  return { content, changed: content !== original };
}

/**
 * Phần tiếng Anh của một version cho trang What's new: bỏ khối tiếng Việt, section ẩn,
 * link commit hash (người dùng không cần; giữ link PR `#42`).
 * @param {string[]} body
 * @returns {string}
 */
export function englishNotes(body) {
  /** @type {string[]} */
  const out = [];
  let hidden = false;
  for (const line of stripViBlock(body)) {
    const h = line.match(/^###\s+(.+?)\s*$/);
    if (h) hidden = HIDDEN_SECTIONS.has(h[1]);
    if (hidden) continue;
    out.push(line.replace(/\s*\(\[[0-9a-f]{7,40}\]\([^)]*\)\)/g, ""));
  }
  return trimBlankEnds(out)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * @typedef {{ version: string, date: string | null, en: string, vi: string | null }} ChangelogEntry
 *   Một phần tử của apps/web/src/generated/changelog.json (mới nhất trước). `date`: YYYY-MM-DD (UTC,
 *   do release-please ghi). `en`/`vi`: markdown; `vi: null` khi version đó chưa có ghi chú tiếng Việt.
 */

/**
 * Chỉ version đã phát hành (có trong CHANGELOG.md) mới vào danh sách; ghi chú tiếng Việt của version
 * chưa phát hành bị bỏ qua.
 * @param {string} changelog nội dung CHANGELOG.md ("" nếu chưa có)
 * @param {Map<string, string>} viNotes version → nội dung changelog/vi/<version>.md
 * @returns {ChangelogEntry[]}
 */
export function buildEntries(changelog, viNotes) {
  const seen = new Set();
  /** @type {ChangelogEntry[]} */
  const entries = [];
  for (const s of parseChangelog(changelog).sections) {
    if (seen.has(s.version)) continue;
    seen.add(s.version);
    const vi = viNotes.get(s.version);
    const viText =
      vi === undefined ? "" : trimBlankEnds(normalizeNewlines(vi).split("\n")).join("\n");
    entries.push({
      version: s.version,
      date: s.date,
      en: englishNotes(s.body),
      vi: viText === "" ? null : viText,
    });
  }
  return entries;
}

/**
 * Tên file hợp lệ trong changelog/vi/ → version (`0.3.0.md` → `0.3.0`); README, mẫu… → null.
 * @param {string} fileName
 */
export function versionFromViFile(fileName) {
  return fileName.match(SEMVER_FILE)?.[1] ?? null;
}

/** @param {string} s */
function normalizeNewlines(s) {
  return s.replace(/\r\n?/g, "\n");
}
