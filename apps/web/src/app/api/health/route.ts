import { NextResponse } from "next/server";

import { appInfo } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Liveness probe for Docker HEALTHCHECK, Coolify and deploy smoke tests (docs/PLAN.md §7.9).
 * Deliberately does not touch the database or collab — that is `/api/health/ready`.
 */
export function GET() {
  return NextResponse.json(
    { status: "ok", ...appInfo() },
    { headers: { "cache-control": "no-store" } },
  );
}
