// Deterministic search corpus for T5.4: ~20k synthetic Vietnamese pages + the hand-written
// "anchor" pages that the golden set (supabase/tests/search_quality/golden.json) points at.
//
//   node scripts/seed-perf.ts --sql > perf.sql        # print SQL (no database needed)
//   node scripts/seed-perf.ts                          # apply via psql (DATABASE_URL, default local)
//   node scripts/seed-perf.ts --pages 2000 --seed 7    # smaller / different corpus
//
// Run against a freshly reset local database (`pnpm db:reset`): it inserts fixtures with the
// superuser connection and relies on the normal triggers to fill `page_documents` and
// `page_search`. Re-running is safe (everything is `on conflict do nothing` / re-applied).
// Only erasable TypeScript syntax is used so Node >= 22.18 runs the file directly.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Anchor = {
  key: string;
  title: string;
  headings: string;
  content: string;
  table: string;
};

export type PerfPage = {
  id: string;
  spaceId: string;
  title: string;
  headings: string;
  content: string;
  table: string;
  /** Days since the page was last edited. */
  ageDays: number;
};

export const DEFAULT_PAGES = 20_000;
export const DEFAULT_SEED = 20260929;
/** User whose view of the corpus is benchmarked: internal Spaces + member of one restricted Space. */
export const VIEWER_ID = "00000000-0000-4000-8000-0000000000b1";
export const ADMIN_ID = "00000000-0000-4000-8000-0000000000a1";

export const SPACES = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    slug: "perf-1",
    visibility: "internal",
    member: false,
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    slug: "perf-2",
    visibility: "internal",
    member: false,
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    slug: "perf-3",
    visibility: "internal",
    member: false,
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    slug: "perf-4",
    visibility: "internal",
    member: false,
  },
  {
    id: "10000000-0000-4000-8000-000000000005",
    slug: "perf-5",
    visibility: "restricted",
    member: true,
  },
  // Viewer is NOT a member: its pages must never appear in results (and cost RLS work).
  {
    id: "10000000-0000-4000-8000-000000000006",
    slug: "perf-6",
    visibility: "restricted",
    member: false,
  },
] as const;
export const ANCHOR_SPACE_ID = SPACES[0].id;
export const HIDDEN_SPACE_ID = SPACES[5].id;

const ANCHOR_PREFIX = "30000000-0000-4000-8000-";
const FILLER_PREFIX = "40000000-0000-4000-8000-";

/** `a07` -> stable page id of that anchor. */
export function anchorId(key: string): string {
  const n = Number(/^a(\d+)$/.exec(key)?.[1]);
  if (!Number.isInteger(n) || n < 1) throw new Error(`bad anchor key ${key}`);
  return ANCHOR_PREFIX + n.toString(16).padStart(12, "0");
}

export function fillerId(index: number): string {
  return FILLER_PREFIX + (index + 1).toString(16).padStart(12, "0");
}

export function loadAnchors(): Anchor[] {
  const url = new URL("../supabase/tests/search_quality/anchors.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as Anchor[];
}

// ---------------------------------------------------------------------------
// Deterministic generator
// ---------------------------------------------------------------------------

/** mulberry32: small seedable PRNG so the corpus is identical on every machine. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Vocabulary is deliberately generic (many pages share the words, like a real wiki) but avoids
// the distinctive terms and phrases of the anchor pages, so each golden query has one clear answer.
// `forbiddenFillerTerms` + the unit test enforce that.
const KINDS = [
  "Quy trình",
  "Hướng dẫn",
  "Chính sách",
  "Báo cáo",
  "Kế hoạch",
  "Biên bản",
  "Danh sách",
  "Quy định",
  "Mẫu",
  "Ghi chú",
  "Tổng hợp",
  "Đề xuất",
];
const DOMAINS = [
  "tuyển dụng",
  "ngân sách",
  "kho vận",
  "chiến dịch tiếp thị",
  "sản phẩm",
  "dự án",
  "phần mềm",
  "bảo trì",
  "kiểm thử",
  "triển khai",
  "đào tạo",
  "chất lượng",
  "tài chính",
  "kế toán",
  "thuế",
  "hóa đơn",
  "lương thưởng",
  "nhà cung cấp",
  "đối tác",
  "khách hàng doanh nghiệp",
  "chăm sóc khách hàng",
  "bán hàng",
  "pháp chế",
  "truyền thông",
  "thiết kế",
  "nghiên cứu thị trường",
  "vận hành",
  "giám sát",
  "tích hợp",
  "di chuyển hệ thống",
];
const QUALIFIERS = [
  "quý 1",
  "quý 2",
  "quý 3",
  "năm nay",
  "khu vực miền Bắc",
  "khu vực miền Nam",
  "bản nháp",
  "phiên bản 2",
  "nội bộ",
  "giai đoạn đầu",
  "giai đoạn hai",
  "tháng 5",
  "tháng 9",
];
const SUBJECTS = [
  "Nhóm dự án",
  "Phòng nhân sự",
  "Bộ phận kế toán",
  "Đội vận hành",
  "Quản lý",
  "Khách hàng",
  "Nhà cung cấp",
  "Nhân viên",
  "Ban lãnh đạo",
  "Đối tác",
  "Người phụ trách",
];
const VERBS = [
  "cần hoàn thành",
  "đã xem xét",
  "sẽ cập nhật",
  "phải kiểm tra",
  "đề xuất điều chỉnh",
  "ghi nhận",
  "thống nhất",
  "theo dõi",
  "phê duyệt",
  "báo cáo lại",
  "chuẩn bị",
  "rà soát",
];
const OBJECTS = [
  "kế hoạch triển khai",
  "danh sách công việc",
  "số liệu báo cáo",
  "yêu cầu của khách hàng",
  "ngân sách dự kiến",
  "tiến độ dự án",
  "kết quả kiểm thử",
  "hợp đồng đối tác",
  "chi phí phát sinh",
  "lịch làm việc",
  "dữ liệu thống kê",
  "đề xuất cải tiến",
  "nội dung đào tạo",
  "mục tiêu quý",
  "tài liệu hướng dẫn",
  "quy mô nhóm",
];
const TAILS = [
  "trước cuối tuần này",
  "trong tháng tới",
  "theo đúng kế hoạch",
  "sau cuộc họp giao ban",
  "khi có thông tin mới",
  "với sự đồng ý của quản lý",
  "để đảm bảo chất lượng",
  "theo phản hồi từ các bên",
  "mà không làm chậm tiến độ",
];
const HEADINGS = [
  "Mục tiêu",
  "Phạm vi",
  "Các bước thực hiện",
  "Trách nhiệm",
  "Lưu ý",
  "Tài liệu liên quan",
  "Kết quả",
  "Rủi ro",
  "Bước tiếp theo",
  "Tổng quan",
];
const FAMILY = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Vũ", "Đặng", "Bùi"];
const MIDDLE = ["Văn", "Thị", "Quốc", "Minh", "Hoài", "Thanh", "Gia", "Ngọc"];
const GIVEN = [
  "Anh",
  "Bình",
  "Châu",
  "Dũng",
  "Hà",
  "Hải",
  "Hạnh",
  "Khoa",
  "Lan",
  "Linh",
  "Minh",
  "Nam",
  "Phúc",
  "Quân",
  "Sơn",
  "Trang",
  "Tuấn",
  "Vy",
];
const DEPARTMENTS = ["Kế toán", "Nhân sự", "Kinh doanh", "Vận hành", "Marketing", "Pháp chế"];

/** Accent-stripped substrings that must never occur in generated filler (they belong to anchors). */
export const forbiddenFillerTerms = [
  "vpn",
  "onboarding",
  "production",
  "postgresql",
  "sev1",
  "nghi phep",
  "xang xe",
  "thuy duong",
  "hau kiem",
  "kien truc",
  "phong hop",
  "van chuyen",
  "bao mat",
  "bao hiem",
  "ky thuat",
  "sao luu",
  "lich truc",
  "mat khau",
  "cong tac",
  "co so",
  "lao dong",
  "nhan vien moi",
  "tu xa",
  "mua sam",
  "nv-20417",
  "nv-20418",
  "nghi le",
];

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

function makeFiller(index: number, rand: () => number): PerfPage {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;

  const title = `${pick(KINDS)} ${pick(DOMAINS)}${rand() < 0.6 ? ` ${pick(QUALIFIERS)}` : ""}`;
  const headingCount = Math.floor(rand() * 4);
  const headings = Array.from({ length: headingCount }, () => pick(HEADINGS)).join("\n");

  const sentenceCount = 4 + Math.floor(rand() * 16);
  const sentences: string[] = [];
  for (let i = 0; i < sentenceCount; i++) {
    sentences.push(`${pick(SUBJECTS)} ${pick(VERBS)} ${pick(OBJECTS)} ${pick(TAILS)}.`);
  }

  let table = "";
  if (rand() < 0.15) {
    const rows = ["Mã | Họ tên | Phòng ban"];
    const rowCount = 2 + Math.floor(rand() * 10);
    for (let r = 0; r < rowCount; r++) {
      const code = 30000 + Math.floor(rand() * 70000);
      rows.push(
        `NV-${code} | ${pick(FAMILY)} ${pick(MIDDLE)} ${pick(GIVEN)} | ${pick(DEPARTMENTS)}`,
      );
    }
    table = rows.join("\n");
  }

  // ~10% of the corpus sits in the Space the viewer cannot see.
  const spaceRoll = rand();
  const spaceId =
    spaceRoll < 0.1
      ? HIDDEN_SPACE_ID
      : (SPACES[Math.floor(rand() * 5)] as (typeof SPACES)[number]).id;

  return {
    id: fillerId(index),
    spaceId,
    title,
    headings,
    content: sentences.join(" "),
    table,
    ageDays: Math.floor(rand() * 720),
  };
}

export function generateFillers(count: number, seed: number = DEFAULT_SEED): PerfPage[] {
  const rand = prng(seed);
  return Array.from({ length: count }, (_, i) => makeFiller(i, rand));
}

export function anchorPages(): PerfPage[] {
  return loadAnchors().map((a, i) => ({
    id: anchorId(a.key),
    spaceId: ANCHOR_SPACE_ID,
    title: a.title,
    headings: a.headings,
    content: a.content,
    table: a.table,
    // Anchors are 1..26 days old: a mild recency edge, like freshly written real pages.
    ageDays: 1 + i,
  }));
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`;

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export function position(index: number): string {
  let n = index;
  let out = "";
  do {
    out = BASE62[n % 62] + out;
    n = Math.floor(n / 62);
  } while (n > 0);
  return out.padStart(4, "0");
}

export function buildSql(pages: PerfPage[], batchSize = 250): string {
  const out: string[] = [];
  out.push("-- Generated by scripts/seed-perf.ts (T5.4). Do not edit.");
  out.push("begin;");
  out.push(
    `insert into auth.users (id, email) values (${lit(ADMIN_ID)}, 'perf-admin@example.com'), (${lit(VIEWER_ID)}, 'perf-viewer@example.com') on conflict (id) do nothing;`,
  );
  // New profiles are guests until an allowlist entry says otherwise; the fixtures are internal users.
  out.push(
    "do $$ begin perform set_config('request.jwt.claim.role', 'service_role', true); end $$;",
    `update public.profiles set is_guest = false where id in (${lit(ADMIN_ID)}, ${lit(VIEWER_ID)});`,
    "do $$ begin perform set_config('request.jwt.claim.role', '', true); end $$;",
  );
  out.push(
    "insert into public.spaces (id, slug, name, visibility, created_by) values\n" +
      SPACES.map(
        (s) =>
          `  (${lit(s.id)}, ${lit(s.slug)}, ${lit(s.slug)}, ${lit(s.visibility)}, ${lit(ADMIN_ID)})`,
      ).join(",\n") +
      "\non conflict (id) do nothing;",
  );
  const members = SPACES.filter((s) => s.member);
  if (members.length > 0) {
    out.push(
      "insert into public.space_members (space_id, user_id, role, added_by) values\n" +
        members
          .map((s) => `  (${lit(s.id)}, ${lit(VIEWER_ID)}, 'viewer', ${lit(ADMIN_ID)})`)
          .join(",\n") +
        "\non conflict do nothing;",
    );
  }

  for (let start = 0; start < pages.length; start += batchSize) {
    const batch = pages.slice(start, start + batchSize);
    out.push(
      "insert into public.pages (id, space_id, position, title, created_by, last_edited_at) values\n" +
        batch
          .map(
            (p, i) =>
              `  (${lit(p.id)}, ${lit(p.spaceId)}, ${lit(position(start + i))}, ${lit(p.title)}, ${lit(ADMIN_ID)}, now() - interval '${p.ageDays} days')`,
          )
          .join(",\n") +
        "\non conflict (id) do nothing;",
    );
    out.push(
      "update public.page_documents as d set content_text = v.content_text, headings_text = v.headings_text, table_text = v.table_text\nfrom (values\n" +
        batch
          .map(
            (p) => `  (${lit(p.id)}::uuid, ${lit(p.content)}, ${lit(p.headings)}, ${lit(p.table)})`,
          )
          .join(",\n") +
        "\n) as v (page_id, content_text, headings_text, table_text)\nwhere d.page_id = v.page_id;",
    );
  }
  out.push("commit;");
  // Planner statistics matter for the benchmark (outside the transaction).
  out.push("vacuum analyze public.page_search;");
  return out.join("\n") + "\n";
}

export function buildCorpus(total: number, seed: number = DEFAULT_SEED): PerfPage[] {
  const anchors = anchorPages();
  return [...anchors, ...generateFillers(Math.max(total - anchors.length, 0), seed)];
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function main(args: string[]): void {
  const total = Number(argValue(args, "--pages") ?? DEFAULT_PAGES);
  const seed = Number(argValue(args, "--seed") ?? DEFAULT_SEED);
  if (!Number.isInteger(total) || total < 1 || !Number.isInteger(seed)) {
    console.error("usage: seed-perf.ts [--sql] [--pages N] [--seed N]");
    process.exit(2);
  }
  const sql = buildSql(buildCorpus(total, seed));
  if (args.includes("--sql")) {
    process.stdout.write(sql);
    return;
  }
  const url = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  const run = spawnSync("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (run.error) {
    console.error(`cannot run psql: ${run.error.message}`);
    process.exit(1);
  }
  if (run.status !== 0) process.exit(run.status ?? 1);
  console.log(`seeded ${total} pages (seed ${seed}); viewer ${VIEWER_ID}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
