import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  anchorId,
  anchorPages,
  buildCorpus,
  buildSql,
  forbiddenFillerTerms,
  generateFillers,
  loadAnchors,
  stripAccents,
} from "./seed-perf.ts";
import {
  buildBenchSql,
  loadGolden,
  parseBenchOutput,
  percentile,
  queryText,
  reciprocalRank,
  summarize,
} from "./search-bench.ts";
import { buildGoldenPgTap } from "./search-golden-sql.ts";

describe("golden set", () => {
  const golden = loadGolden();
  const anchorKeys = new Set(loadAnchors().map((a) => a.key));

  it("has 30 uniquely identified queries", () => {
    assert.equal(golden.length, 30);
    assert.equal(new Set(golden.map((g) => g.id)).size, 30);
  });

  it("only references existing anchors", () => {
    for (const g of golden) {
      assert.ok(g.expect.length > 0, g.id);
      for (const key of [...g.expect, ...(g.forbid ?? [])])
        assert.ok(anchorKeys.has(key), `${g.id} -> ${key}`);
    }
  });

  it("covers the query kinds of PLAN section 4.4", () => {
    const kinds = new Set(golden.map((g) => g.kind));
    for (const k of [
      "unaccented",
      "accented",
      "nfd",
      "phrase",
      "prefix",
      "typo",
      "table",
      "code",
      "exclude",
    ]) {
      assert.ok(kinds.has(k), k);
    }
  });

  it("sends NFD text for nfd queries", () => {
    const g = golden.find((x) => x.nfd);
    assert.notEqual(queryText(g), g.q);
    assert.equal(queryText(g).normalize("NFC"), g.q);
  });

  it("keeps the committed pgTAP file in sync (node scripts/search-golden-sql.ts > golden.test.sql)", () => {
    const committed = readFileSync(
      new URL("../supabase/tests/search_quality/golden.test.sql", import.meta.url),
      "utf8",
    );
    assert.equal(committed, buildGoldenPgTap());
  });
});

describe("corpus", () => {
  it("is deterministic and sized as asked", () => {
    const a = buildCorpus(500, 1);
    const b = buildCorpus(500, 1);
    assert.equal(a.length, 500);
    assert.deepEqual(a, b);
    assert.notDeepEqual(generateFillers(50, 1), generateFillers(50, 2));
  });

  it("has unique ids and the 20k default size", () => {
    const corpus = buildCorpus(20_000);
    assert.equal(corpus.length, 20_000);
    assert.equal(new Set(corpus.map((p) => p.id)).size, 20_000);
  });

  it("never lets filler text contain anchor-specific terms", () => {
    for (const p of generateFillers(3000)) {
      const text = stripAccents([p.title, p.headings, p.content, p.table].join("\n"));
      for (const term of forbiddenFillerTerms)
        assert.ok(!text.includes(term), `${term} in ${p.id}`);
    }
  });

  it("keeps anchors in a visible Space and escapes quotes in SQL", () => {
    assert.equal(anchorPages().length, loadAnchors().length);
    const sql = buildSql([{ ...anchorPages()[0], title: "L'a" }]);
    assert.match(sql, /'L''a'/);
    assert.match(sql, /^begin;$/m);
    assert.match(sql, /^vacuum analyze public\.page_search;$/m);
  });
});

describe("benchmark maths", () => {
  it("computes reciprocal rank within the top K", () => {
    assert.equal(reciprocalRank(["x", "y", "z"], ["y"]), 0.5);
    assert.equal(reciprocalRank(["x"], ["q"]), 0);
    assert.equal(reciprocalRank(Array(10).fill("x").concat("y"), ["y"]), 0);
  });

  it("computes nearest-rank percentiles", () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.equal(percentile(v, 95), 95);
    assert.equal(percentile([5], 95), 5);
    assert.ok(Number.isNaN(percentile([], 95)));
  });

  it("summarises parsed psql notices into MRR and p95", () => {
    const golden = loadGolden().slice(0, 2);
    const hit = anchorId(golden[0].expect[0]);
    const stderr = [
      `psql:x:1: NOTICE:  BENCH|${golden[0].id}|warm|90.00|${hit}`,
      `psql:x:1: NOTICE:  BENCH|${golden[0].id}|run|10.50|${hit}`,
      `psql:x:1: NOTICE:  BENCH|${golden[1].id}|run|20.00|${anchorId("a25")},${anchorId(golden[1].expect[0])}`,
    ].join("\n");
    const { results, summary } = summarize(golden, parseBenchOutput(stderr));
    assert.equal(results[0].rank, 1);
    assert.equal(results[1].rank, 2);
    assert.equal(summary.mrr, 0.75);
    assert.equal(summary.p95Ms, 20);
    assert.equal(summary.passed, false); // MRR below 0.8
  });

  it("clears the rate limit before each call", () => {
    const sql = buildBenchSql(loadGolden().slice(0, 1), 2);
    assert.equal((sql.match(/delete from app\.rate_limit_hits;/g) ?? []).length, 3);
  });
});
