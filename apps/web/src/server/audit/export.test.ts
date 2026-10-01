import { describe, expect, it, vi } from "vitest";

import { AuditError, auditActionsForEntityTypes, listAuditLogs, type AuditDb } from "./index";
import { auditEntriesToCsv, csvCell, exportAuditLogsCsv, type AuditExportDb } from "./export";

const U = "5d2f0000-0000-4000-8000-000000000002";
const S = "0b9a0000-0000-4000-8000-000000000001";

const row = (id: number) => ({
  id,
  occurred_at: "2026-09-25T03:15:00.000+00:00",
  action: "page.move",
  entity_type: "page",
  entity_id: null,
  space_id: S,
  metadata: { title: 'a,"b"' },
  actor_id: U,
  actor_email: "an@x.vn",
  actor_full_name: "=cmd",
  actor_avatar_url: null,
});

function fakeDb(opts: { user?: boolean; superAdmin?: boolean; role?: string; rows?: number }) {
  const rpc = vi.fn(async (_fn: string, args: { p_limit: number; p_before_id?: number }) => {
    const total = opts.rows ?? 0;
    const start = args.p_before_id ? args.p_before_id - 1 : total;
    const n = Math.min(args.p_limit, Math.max(start, 0));
    return { data: Array.from({ length: n }, (_, i) => row(start - i)), error: null };
  });
  const chain = (data: Record<string, unknown> | null) => {
    const c = { eq: () => c, maybeSingle: async () => ({ data, error: null }) };
    return c;
  };
  const db = {
    rpc,
    auth: { getUser: async () => ({ data: { user: opts.user === false ? null : { id: U } } }) },
    from: (table: string) => ({
      select: () =>
        chain(
          table === "profiles"
            ? { is_super_admin: !!opts.superAdmin }
            : { role: opts.role ?? "viewer" },
        ),
    }),
  };
  return { db: db as unknown as AuditExportDb, rpc };
}

describe("csvCell", () => {
  it("quotes and neutralizes formulas", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+x")).toBe("'+x");
    expect(csvCell(null)).toBe("");
  });
});

describe("auditActionsForEntityTypes / listAuditLogs entityTypes", () => {
  it("maps types to actions", () => {
    expect(auditActionsForEntityTypes(["version"])).toEqual(["version.restore"]);
    expect(auditActionsForEntityTypes(["page"])).toContain("page.move");
  });

  it("passes the intersection with actions to the RPC, or returns empty without a call", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const db = { rpc } as unknown as AuditDb;
    await listAuditLogs(db, {
      entityTypes: ["version"],
      actions: ["version.restore", "page.move"],
    });
    expect(rpc).toHaveBeenCalledWith(
      "list_audit_logs",
      expect.objectContaining({ p_actions: ["version.restore"] }),
    );
    rpc.mockClear();
    const empty = await listAuditLogs(db, { entityTypes: ["version"], actions: ["page.move"] });
    expect(empty).toEqual({ entries: [], nextCursor: null });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("auditEntriesToCsv", () => {
  it("writes BOM, header and CRLF", () => {
    expect(auditEntriesToCsv([])).toBe(
      "﻿occurred_at,action,entity_type,entity_id,space_id,actor_id,actor_email,actor_name,metadata\r\n",
    );
  });
});

describe("exportAuditLogsCsv", () => {
  it("rejects anonymous and non-admin callers", async () => {
    await expect(
      exportAuditLogsCsv(fakeDb({ user: false }).db, { spaceId: S }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(exportAuditLogsCsv(fakeDb({}).db, { spaceId: S })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(exportAuditLogsCsv(fakeDb({ role: "admin" }).db, {})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("validates input", async () => {
    await expect(
      exportAuditLogsCsv(fakeDb({ superAdmin: true }).db, { actorId: "nope" }),
    ).rejects.toBeInstanceOf(AuditError);
  });

  it("exports all pages for a space admin", async () => {
    const { db, rpc } = fakeDb({ role: "admin", rows: 130 });
    const out = await exportAuditLogsCsv(db, { spaceId: S }, new Date("2026-10-01T00:00:00Z"));
    expect(out.rowCount).toBe(130);
    expect(out.truncated).toBe(false);
    expect(out.filename).toBe("audit-2026-10-01.csv");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(out.csv.split("\r\n")).toHaveLength(132);
    expect(out.csv).toContain("'=cmd");
  });

  it("truncates at the row cap", async () => {
    const { db } = fakeDb({ superAdmin: true, rows: 10_500 });
    const out = await exportAuditLogsCsv(db, {});
    expect(out.rowCount).toBe(10_000);
    expect(out.truncated).toBe(true);
  });
});
