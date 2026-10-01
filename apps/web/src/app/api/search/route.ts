import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { SearchError, searchPages, type SearchErrorCode } from "@/server/search";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

const STATUS: Record<SearchErrorCode, number> = {
  FORBIDDEN: 403,
  RATE_LIMITED: 429,
  SEARCH_FAILED: 500,
  UNAUTHORIZED: 401,
  VALIDATION_FAILED: 400,
};

/**
 * `GET /api/search?q=nghi+phep&space=<uuid>&space=<uuid>&limit=20&offset=0` (T5.2).
 * 200 `{ results: SearchResult[] }`; errors `{ error: <CODE> }` (client shows `errors.<CODE>`),
 * 429 carries `Retry-After`. Per-user rate limit is enforced inside the `search_pages` RPC.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return fail(new SearchError("UNAUTHORIZED"));

  const params = request.nextUrl.searchParams;
  try {
    const output = await searchPages(supabase, {
      q: params.get("q") ?? "",
      spaceIds: params.getAll("space"),
      limit: numberParam(params.get("limit")),
      offset: numberParam(params.get("offset")),
    });
    return NextResponse.json(output, { headers: noStore });
  } catch (error) {
    return fail(error instanceof SearchError ? error : new SearchError("SEARCH_FAILED"));
  }
}

function numberParam(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

function fail(error: SearchError) {
  const headers: Record<string, string> = { ...noStore };
  if (error.retryAfterSeconds) headers["retry-after"] = String(error.retryAfterSeconds);
  return NextResponse.json({ error: error.code }, { status: STATUS[error.code], headers });
}
