import { NextResponse, type NextRequest } from "next/server";

import { DEPLOYED_APP_ENVS, type AppEnv } from "@kb/shared/env";

import { contentSecurityPolicy } from "@/lib/security-headers";
import { supabaseUrl } from "@/lib/supabase/env";
import { ensureBootstrapAccess } from "@/server/auth/bootstrap";
import { isPublicPath } from "@/server/auth/utils";

import { updateSession } from "./lib/supabase/middleware";

/** Screens a signed-out visitor may reach without a session. */
const PUBLIC_PATHS = ["/login", "/access-denied", "/auth/callback"];

/**
 * Need a session, but not `app.has_active_access`: a guest signs up through a pending invitation
 * and only gets a membership once they accept it on `/invite/<token>` (T1.5a). Signed-out
 * visitors still go to `/login?next=/invite/<token>`, which returns here after Google sign-in.
 */
const SESSION_ONLY_PATHS = ["/invite"];

/**
 * Auth gate for every app route (see docs/ai/tasks.yaml T1.2a). Also refreshes the Supabase
 * session cookie (Server Components can only read cookies, not write them) and keeps
 * `BOOTSTRAP_SUPER_ADMIN_EMAILS` synced into the DB (see `server/auth/bootstrap.ts`) — cheap
 * after the first request per server process, so it runs unconditionally rather than only on
 * `/login`.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  return withContentSecurityPolicy(await gate(request));
}

let cachedCsp: string | undefined;

/**
 * CSP of page responses (T7.2). Built from runtime settings — the Supabase and collab origins are
 * not known at build time — once per server process. Static headers live in next.config.ts.
 */
function withContentSecurityPolicy(response: NextResponse): NextResponse {
  cachedCsp ??= contentSecurityPolicy({
    supabaseUrl: supabaseUrl(),
    collabUrl: process.env.COLLAB_PUBLIC_URL,
    dev: process.env.NODE_ENV === "development",
    upgradeInsecureRequests: DEPLOYED_APP_ENVS.includes(process.env.APP_ENV as AppEnv),
  });
  response.headers.set("Content-Security-Policy", cachedCsp);
  return response;
}

async function gate(request: NextRequest): Promise<NextResponse> {
  await ensureBootstrapAccess().catch((error: unknown) => {
    console.error("[auth] bootstrap sync failed", error);
  });

  const { pathname, search } = request.nextUrl;
  const { response, user, accessRevoked } = await updateSession(request, {
    checkAccess: !isPublicPath(pathname, SESSION_ONLY_PATHS),
  });

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
