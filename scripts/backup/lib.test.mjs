// Tests for the pure helpers of infra/backup/lib.sh (object names, retention tiers, URL handling).
// The whole image is tested end to end by infra/backup/e2e-test.sh (build-images.yml).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const LIB = join(root, "infra/backup/lib.sh");

/**
 * Runs `fn args…` with lib.sh sourced (sh, as in the image) and returns its output.
 * @param {string} fn
 * @param {string[]} [args]
 * @param {{ input?: string, env?: Record<string, string> }} [options]
 */
const call = (fn, args = [], { input, env } = {}) => {
  const result = spawnSync("sh", ["-c", `. "$0"; ${fn} "$@"`, LIB, ...args], {
    encoding: "utf8",
    input,
    env: { PATH: process.env.PATH ?? "", ...env },
  });
  return { code: result.status, out: result.stdout.trim(), err: result.stderr };
};

/** @param {string} iso */
const epoch = (iso) => String(Date.parse(iso) / 1000);

describe("backup_name / name_epoch", () => {
  it("names a backup after its UTC time, sortable and unique per second", () => {
    assert.equal(call("backup_name", [epoch("2026-09-26T19:00:05Z")]).out, "2026-09-26T190005Z");
  });

  it("reads the time back from any key holding such a name", () => {
    const e = epoch("2026-09-26T19:00:05Z");
    assert.equal(call("name_epoch", ["2026-09-26T190005Z"]).out, e);
    assert.equal(call("name_epoch", ["prod/daily/2026-09-26T190005Z.dump.age"]).out, e);
    assert.equal(call("name_epoch", ["v0.2.0-2026-09-26T190005Z"]).out, e);
    assert.notEqual(call("name_epoch", ["latest.dump.age"]).code, 0);
  });
});

describe("backup_tiers (calendar of Asia/Ho_Chi_Minh)", () => {
  it("is only daily on an ordinary day", () => {
    // Tue 2026-09-22 02:00 ICT
    assert.equal(call("backup_tiers", [epoch("2026-09-21T19:00:00Z")]).out, "daily");
  });

  it("adds weekly on Sunday in ICT even when it is still Saturday in UTC", () => {
    // Sat 2026-09-26 19:00 UTC = Sun 2026-09-27 02:00 ICT
    assert.deepEqual(call("backup_tiers", [epoch("2026-09-26T19:00:00Z")]).out.split("\n"), [
      "daily",
      "weekly",
    ]);
  });

  it("adds monthly on the 1st in ICT", () => {
    // Wed 2026-09-30 19:00 UTC = Thu 2026-10-01 02:00 ICT
    assert.deepEqual(call("backup_tiers", [epoch("2026-09-30T19:00:00Z")]).out.split("\n"), [
      "daily",
      "monthly",
    ]);
    // Sun 2026-11-01 02:00 ICT: all three
    assert.deepEqual(call("backup_tiers", [epoch("2026-10-31T19:00:00Z")]).out.split("\n"), [
      "daily",
      "weekly",
      "monthly",
    ]);
  });

  it("follows KB_BACKUP_TZ", () => {
    const out = call("backup_tiers", [epoch("2026-09-26T19:00:00Z")], {
      env: { KB_BACKUP_TZ: "UTC" },
    });
    assert.equal(out.out, "daily");
  });
});

describe("latest_backup", () => {
  it("picks the newest complete dump from an rclone listing", () => {
    const listing = [
      "2026-09-24T190001Z.dump.age",
      "2026-09-24T190001Z.roles.sql.age",
      "2026-09-26T190002Z.roles.sql.age", // dump not uploaded yet → incomplete
      "2026-09-25T190003Z.dump.age",
      "2026-09-25T190003Z.roles.sql.age",
      "notes.txt",
    ].join("\n");
    assert.equal(call("latest_backup", [], { input: listing }).out, "2026-09-25T190003Z");
  });

  it("orders pre-migrate backups by time, not by label", () => {
    const listing = [
      "v0.9.0-2026-10-01T010000Z.dump.age",
      "v0.10.0-2026-11-01T010000Z.dump.age",
      "v0.10.0-2026-11-01T010000Z.roles.sql.age",
    ].join("\n");
    assert.equal(call("latest_backup", [], { input: listing }).out, "v0.10.0-2026-11-01T010000Z");
  });

  it("prints nothing for an empty prefix", () => {
    const r = call("latest_backup", [], { input: "" });
    assert.equal(r.out, "");
  });
});

describe("age_hours", () => {
  it("rounds down", () => {
    assert.equal(call("age_hours", ["93599", "0"]).out, "25");
    assert.equal(call("age_hours", ["93600", "0"]).out, "26");
  });
});

describe("safe_label / safe_db_name", () => {
  it("accepts version-like labels only", () => {
    assert.equal(call("safe_label", ["v0.2.0"]).out, "v0.2.0");
    assert.equal(call("safe_label", ["prod"]).out, "prod");
    for (const bad of ["", "../x", "a/b", "-x", "a b", "x".repeat(65)]) {
      assert.notEqual(call("safe_label", [bad]).code, 0, bad);
    }
  });

  it("never lets restore touch the live or template databases", () => {
    assert.equal(call("safe_db_name", ["kb_restore"]).out, "kb_restore");
    for (const bad of [
      "postgres",
      "template0",
      "template1",
      "_supabase",
      "KB",
      "kb-restore",
      "a;b",
    ]) {
      assert.notEqual(call("safe_db_name", [bad]).code, 0, bad);
    }
  });
});

describe("url_with_db / url_host", () => {
  it("switches the database and keeps credentials and query", () => {
    assert.equal(
      call("url_with_db", ["postgresql://u:p@db:5432/postgres?sslmode=disable", "kb_restore"]).out,
      "postgresql://u:p@db:5432/kb_restore?sslmode=disable",
    );
    assert.equal(
      call("url_with_db", ["postgresql://u:p@db:5432", "kb_restore"]).out,
      "postgresql://u:p@db:5432/kb_restore",
    );
  });

  it("logs the host only, never the password", () => {
    const out = call("url_host", [
      "postgresql://postgres:s3cret@supabase-db-abc:5432/postgres",
    ]).out;
    assert.equal(out, "supabase-db-abc:5432");
  });
});

describe("require_env", () => {
  it("lists every missing variable and exits non-zero", () => {
    const r = call("require_env", ["A_SET", "B_MISSING", "C_MISSING"], { env: { A_SET: "1" } });
    assert.equal(r.code, 1);
    assert.match(r.err, /Invalid environment variables/);
    assert.match(r.err, /B_MISSING: is required/);
    assert.match(r.err, /C_MISSING: is required/);
    assert.doesNotMatch(r.err, /A_SET/);
  });
});

describe("idempotent_roles", () => {
  it("wraps CREATE ROLE only", () => {
    const input = [
      "CREATE ROLE kb_collab;",
      "ALTER ROLE kb_collab WITH NOSUPERUSER LOGIN;",
      'CREATE ROLE "odd-name";',
    ].join("\n");
    const out = call("idempotent_roles", [], { input }).out.split("\n");
    assert.equal(
      out[0],
      "DO $kb$ BEGIN CREATE ROLE kb_collab; EXCEPTION WHEN duplicate_object THEN NULL; END $kb$;",
    );
    assert.equal(out[1], "ALTER ROLE kb_collab WITH NOSUPERUSER LOGIN;");
    assert.match(out[2], /CREATE ROLE "odd-name"; EXCEPTION/);
  });
});
