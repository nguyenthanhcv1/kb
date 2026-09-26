// Đọc trạng thái từ git/GitHub — nguồn sự thật duy nhất (WORKFLOW §1, §5).
import { execFileSync } from "node:child_process";
import { doneIdsFromSubjects, inProgressIds } from "./lib.mjs";

/** @param {string[]} args */
function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * `owner/repo` từ GITHUB_REPOSITORY hoặc URL của remote `origin`.
 * @returns {string | null}
 */
export function repoSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const url = git(["remote", "get-url", "origin"]).trim();
    const m = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Tiêu đề các PR đang mở qua GitHub REST API. Token lấy từ GITHUB_TOKEN/GH_TOKEN (không bắt buộc
 * với repo public). Lỗi mạng/quyền → trả `null` để lệnh gọi cảnh báo thay vì dừng.
 * @param {string} slug
 * @returns {Promise<string[] | null>}
 */
export async function openPrTitles(slug) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  /** @type {Record<string, string>} */
  const headers = { accept: "application/vnd.github+json", "user-agent": "kb-ai-tools" };
  if (token) headers.authorization = `Bearer ${token}`;
  /** @type {string[]} */
  const titles = [];
  try {
    for (let page = 1; page <= 10; page++) {
      const res = await fetch(
        `https://api.github.com/repos/${slug}/pulls?state=open&per_page=100&page=${page}`,
        { headers, signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) return null;
      const batch = /** @type {{ title: string }[]} */ (await res.json());
      titles.push(...batch.map((p) => p.title));
      if (batch.length < 100) break;
    }
    return titles;
  } catch {
    return null;
  }
}

/**
 * @param {{ fetch?: boolean, prs?: boolean }} [opts]
 * @returns {Promise<{ done: Set<string>, inProgress: Set<string>, warnings: string[] }>}
 */
export async function readRepoState(opts = {}) {
  /** @type {string[]} */
  const warnings = [];
  if (opts.fetch !== false) {
    try {
      git(["fetch", "origin", "--prune", "--quiet"]);
    } catch {
      warnings.push("git fetch origin thất bại — dùng dữ liệu remote đã có trên máy.");
    }
  }
  const subjects = git(["log", "origin/main", "--format=%s"]).split("\n");
  const branches = git(["for-each-ref", "refs/remotes/origin", "--format=%(refname:short)"])
    .split("\n")
    .filter(Boolean)
    .map((b) => b.replace(/^origin\//, ""));

  /** @type {string[]} */
  let titles = [];
  if (opts.prs !== false) {
    const slug = repoSlug();
    const fetched = slug ? await openPrTitles(slug) : null;
    if (fetched) titles = fetched;
    else
      warnings.push(
        "Không đọc được danh sách PR đang mở (đặt GITHUB_TOKEN/GH_TOKEN?) — task chỉ được nhận " +
          "qua draft PR (nhánh bị môi trường ép tên) có thể bị tính là chưa ai làm.",
      );
  }
  return {
    done: doneIdsFromSubjects(subjects),
    inProgress: inProgressIds(branches, titles),
    warnings,
  };
}

/**
 * Tham số `--name value` / `--flag` đơn giản.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [key, inline] = a.slice(2).split("=", 2);
    if (inline !== undefined) out[key] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}
