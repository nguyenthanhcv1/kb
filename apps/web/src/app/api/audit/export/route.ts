import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  AUDIT_ENTITY_TYPES,
  AuditError,
  isAuditAction,
  type AuditAction,
  type AuditEntityType,
  type AuditErrorCode,
} from "@/server/audit";
import { exportAuditLogsCsv, type AuditExportDb } from "@/server/audit/export";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

const STATUS: Record<AuditErrorCode, number> = {
  AUDIT_QUERY_FAILED: 500,
  FORBIDDEN: 403,
  UNAUTHORIZED: 401,
  VALIDATION_FAILED: 400,
};

function isEntityType(value: string): value is AuditEntityType {
  return (AUDIT_ENTITY_TYPES as readonly string[]).includes(value);
}

/**
 * `GET /api/audit/export?space=<uuid>&action=<code>&type=<entityType>&actor=<uuid>&from=<iso>&to=<iso>`
 * (T6.4a; `action` and `type` may repeat). 200 CSV attachment; errors `{ error: <CODE> }`.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const p = request.nextUrl.searchParams;
  const actions = p.getAll("action").filter(Boolean);
  const types = p.getAll("type").filter(Boolean);
  try {
    if (!actions.every(isAuditAction) || !types.every(isEntityType)) {
      throw new AuditError("VALIDATION_FAILED");
    }
    const out = await exportAuditLogsCsv(supabase as unknown as AuditExportDb, {
      spaceId: p.get("space") || undefined,
      actions: actions.length ? (actions as AuditAction[]) : undefined,
      entityTypes: types.length ? (types as AuditEntityType[]) : undefined,
      actorId: p.get("actor") || undefined,
      from: p.get("from") || undefined,
      to: p.get("to") || undefined,
    });
    return new NextResponse(out.csv, {
      headers: {
        ...noStore,
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${out.filename}"`,
        ...(out.truncated ? { "x-audit-truncated": "1" } : {}),
      },
    });
  } catch (error) {
    const err = error instanceof AuditError ? error : new AuditError("AUDIT_QUERY_FAILED");
    if (err.code === "AUDIT_QUERY_FAILED") console.error("[audit] export failed", err.cause ?? err);
    return NextResponse.json({ error: err.code }, { status: STATUS[err.code], headers: noStore });
  }
}
