import { NextResponse, type NextRequest } from "next/server";

import { ensureBootstrapAccess } from "@/server/auth/bootstrap";
import { isPublicPath } from "@/server/auth/utils";

import { updateSession } from "./lib/supabase/middleware";

/** Screens a signed-out visitor may reach without a session. */
const PUBLIC_PATHS = ["/login", "/access-denied", "/auth/callback"];

/**
 * Auth gate for every app route (see docs/ai/tasks.yaml T1.2a). Also refreshes the Supabase
 * session cookie (Server Components can only read cookies, not write them) and keeps
 * `BOOTSTRAP_SUPER_ADMIN_EMAILS` synced into the DB (see `server/auth/bootstrap.ts`) — cheap
 * after the first request per server process, so it runs unconditionally rather than only on
 * `/login`.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  await ensureBootstrapAccess().catch((error: unknown) => {
    console.error("[auth] bootstrap sync failed", error);
  });

  const { response, user, accessRevoked } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  if (!user && !isPublicPath(pathname, PUBLIC_PATHS)) {
    const loginUrl = new URL("/login", request.url);
    if (accessRevoked) {
      loginUrl.searchParams.set("error", "AUTH_ACCESS_REVOKED");
    } else {
      loginUrl.searchParams.set("next", `${pathname}${search}`);
    }
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
