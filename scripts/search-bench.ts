// Search quality + latency benchmark for T5.4.
//
//   node scripts/seed-perf.ts                 # once, on a freshly reset local database
//   node scripts/search-bench.ts              # 30 golden queries x 5 timed repeats
//   node scripts/search-bench.ts --repeats 20 --json
//
// Calls public.search_pages() as an `authenticated` user (RLS on), so the numbers include
// permission filtering. The rate-limit counter is cleared before every call (the product limit of
// 60/min would otherwise stop the run). Latency is the in-database execution time of the RPC
// (clock_timestamp around the call), i.e. it excludes PostgREST, network and Next.js.
// Exit code 1 when MRR < 0.8, p95 >= 300 ms or a "forbid" page shows up in a result.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { anchorId, VIEWER_ID } from "./seed-perf.ts";

export type GoldenQuery = {
  id: string;
  q: string;
  kind: string;
  nfd?: boolean;
  expect: string[];
  forbid?: string[];
};

export const MRR_TARGET = 0.8;
export const P95_TARGET_MS = 300;
export const TOP_K = 10;

export function loadGolden(): GoldenQuery[] {
  const url = new URL("../supabase/tests/search_quality/golden.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as GoldenQuery[];
}

/** The text actually sent to the RPC (NFD variants test composed/decomposed input). */
export function queryText(g: GoldenQuery): string {
  return g.nfd ? g.q.normalize("NFD") : g.q;
}

/** 1/rank of the first relevant id within the top K, else 0. */
export function reciprocalRank(resultIds: string[], relevant: string[], k: number = TOP_K): number {
  const set = new Set(relevant);
  const idx = resultIds.slice(0, k).findIndex((id) => set.has(id));
  return idx < 0 ? 0 : 1 / (idx + 1);
}

/** Nearest-rank percentile (p in 0..100). */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] as number;
}

const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** One psql script: warm-up call + `repeats` timed calls per golden query, one NOTICE per call. */
export function buildBenchSql(
  golden: GoldenQuery[],
  repeats: number,
  viewerId: string = VIEWER_ID,
): string {
  const lines: string[] = ["\\set ON_ERROR_STOP on", "set client_min_messages = notice;", "begin;"];
  for (const g of golden) {
    for (let rep = 0; rep <= repeats; rep++) {
      const label = `${g.id}|${rep === 0 ? "warm" : "run"}`;
      lines.push(
        "reset role;",
        "delete from app.rate_limit_hits;",
        "set local role authenticated;",
        `select set_config('request.jwt.claim.sub', ${lit(viewerId)}, true);`,
        "do $bench$",
        "declare t0 timestamptz; ids uuid[];",
        "begin",
        "  t0 := clock_timestamp();",
        "  select coalesce(array_agg(s.page_id order by s.n), '{}') into ids from (",
        `    select r.page_id, row_number() over () as n from public.search_pages(${lit(queryText(g))}, null, ${TOP_K}, 0) as r`,
        "  ) as s;",
        `  raise notice 'BENCH|${label}|%|%', round((extract(epoch from clock_timestamp() - t0) * 1000)::numeric, 2), array_to_string(ids, ',');`,
        "end",
        "$bench$;",
      );
    }
  }
  lines.push("rollback;");
  return lines.join("\n") + "\n";
}

type Sample = { id: string; phase: string; ms: number; ids: string[] };

export function parseBenchOutput(stderr: string): Sample[] {
  const out: Sample[] = [];
  for (const line of stderr.split("\n")) {
    const m = /BENCH\|([^|]+)\|([^|]+)\|([\d.]+)\|(.*)$/.exec(line);
    if (m)
      out.push({
        id: m[1] as string,
        phase: m[2] as string,
        ms: Number(m[3]),
        ids: (m[4] as string).split(",").filter(Boolean),
      });
  }
  return out;
}

export type QueryResult = {
  id: string;
  q: string;
  kind: string;
  rr: number;
  rank: number | null;
  forbidden: string[];
  medianMs: number;
  top: string[];
};

export type Summary = {
  queries: number;
  mrr: number;
  hitAt1: number;
  hitAt3: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  forbiddenHits: number;
  passed: boolean;
};

export function summarize(
  golden: GoldenQuery[],
  samples: Sample[],
): { results: QueryResult[]; summary: Summary } {
  const results: QueryResult[] = golden.map((g) => {
    const mine = samples.filter((s) => s.id === g.id);
    const timed = mine.filter((s) => s.phase === "run");
    const last = (timed.length > 0 ? timed : mine).at(-1);
    const top = last?.ids ?? [];
    const rr = reciprocalRank(top, g.expect.map(anchorId));
    const forbid = new Set((g.forbid ?? []).map(anchorId));
    return {
      id: g.id,
      q: g.q,
      kind: g.kind,
      rr,
      rank: rr > 0 ? Math.round(1 / rr) : null,
      forbidden: top.filter((id) => forbid.has(id)),
      medianMs: percentile(
        timed.map((s) => s.ms),
        50,
      ),
      top,
    };
  });
  const latencies = samples.filter((s) => s.phase === "run").map((s) => s.ms);
  const n = Math.max(results.length, 1);
  const mrr = results.reduce((a, r) => a + r.rr, 0) / n;
  const p95Ms = percentile(latencies, 95);
  const forbiddenHits = results.reduce((a, r) => a + r.forbidden.length, 0);
  const summary: Summary = {
    queries: results.length,
    mrr,
    hitAt1: results.filter((r) => r.rank === 1).length / n,
    hitAt3: results.filter((r) => r.rank !== null && r.rank <= 3).length / n,
    p50Ms: percentile(latencies, 50),
    p95Ms,
    maxMs: latencies.length > 0 ? Math.max(...latencies) : Number.NaN,
    forbiddenHits,
    passed: results.length > 0 && mrr >= MRR_TARGET && p95Ms < P95_TARGET_MS && forbiddenHits === 0,
  };
  return { results, summary };
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function main(args: string[]): void {
  const repeats = Number(argValue(args, "--repeats") ?? 5);
  const golden = loadGolden();
  const sql = buildBenchSql(golden, repeats);
  if (args.includes("--sql")) {
    process.stdout.write(sql);
    return;
  }
  const url = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  const run = spawnSync("psql", [url, "-X", "-q"], {
    input: sql,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error || run.status !== 0) {
    console.error(
      run.error?.message ??
        run.stderr
          .split("\n")
          .filter((l) => !l.includes("BENCH|"))
          .join("\n"),
    );
    process.exit(1);
  }
  const samples = parseBenchOutput(run.stderr);
  const { results, summary } = summarize(golden, samples);
  if (args.includes("--json")) {
    console.log(JSON.stringify({ summary, results }, null, 2));
  } else {
    for (const r of results) {
      const mark = r.rank === 1 ? "ok " : r.rank ? `#${r.rank} ` : "MISS";
      console.log(
        `${r.id} ${mark.padEnd(5)} ${r.medianMs.toFixed(1).padStart(7)} ms  [${r.kind}] ${r.q}${r.forbidden.length > 0 ? "  FORBIDDEN RESULT" : ""}`,
      );
    }
    console.log(
      `\nqueries=${summary.queries} MRR=${summary.mrr.toFixed(3)} (>= ${MRR_TARGET}) hit@1=${summary.hitAt1.toFixed(2)} hit@3=${summary.hitAt3.toFixed(2)} ` +
        `p50=${summary.p50Ms.toFixed(1)} ms p95=${summary.p95Ms.toFixed(1)} ms (< ${P95_TARGET_MS}) max=${summary.maxMs.toFixed(1)} ms forbidden=${summary.forbiddenHits}`,
    );
    console.log(summary.passed ? "PASS" : "FAIL");
  }
  process.exit(summary.passed ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
