import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { supabaseAnonKey, supabaseUrl } from "./env";

export interface SessionResult {
  /** Response to return from the middleware — carries the refreshed session cookies. */
  response: NextResponse;
  /** Signed-in user, re-validated against Supabase Auth (not just decoded from the cookie). */
  user: { id: string; email: string } | null;
  /** `user` is `null` because `app.has_active_access` just revoked an existing session. */
  accessRevoked: boolean;
  /**
   * The user is signed in but their account still waits for a super admin (`pending`): the session
   * stays, but only the "waiting for approval" screen may be shown.
   */
  accountPending: boolean;
  /** `user` is `null` because the account was rejected (the session was ended). */
  accountRejected: boolean;
}

/**
 * Refreshes the session cookie (Server Components can't write cookies, only middleware can) and
 * returns the current user. Uses `getUser()`, which re-checks the JWT with the Auth server,
 * instead of `getSession()`, which only decodes the cookie — see Supabase's SSR security notes.
 *
 * `checkAccess: false` skips the `app.has_active_access` revocation check (the invite page: a
 * guest who just signed up through an invitation has no membership until they accept it).
 */
export async function updateSession(
  request: NextRequest,
  options: { checkAccess?: boolean } = {},
): Promise<SessionResult> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return {
      response,
      user: null,
      accessRevoked: false,
      accountPending: false,
      accountRejected: false,
    };
  }

  if (options.checkAccess !== false && !(await hasActiveAccess(supabase))) {
    const status = await accountStatus(supabase);
    if (status === "pending") {
      return {
        response,
        user: { id: user.id, email: user.email },
        accessRevoked: false,
        accountPending: true,
        accountRejected: false,
      };
    }
    await supabase.auth.signOut();
    return {
      response,
      user: null,
      accessRevoked: status !== "rejected",
      accountPending: false,
      accountRejected: status === "rejected",
    };
  }

  return {
    response,
    user: { id: user.id, email: user.email },
    accessRevoked: false,
    accountPending: false,
    accountRejected: false,
  };
}

/**
 * Re-checks `app.has_active_access` (T1.2a migration) as the signed-in caller — not
 * service_role, so it only ever answers for the caller's own `auth.uid()`. `before_user_created_hook`
 * only runs once, at sign-up; without this, removing someone's email/domain from
 * `access_allowlist` would never actually end their already-issued session. A transport error
 * (DB/network hiccup) fails *open* — this call adds a revocation check on top of the JWT
 * validation `getUser()` already did, it does not replace it, so a failure here should not turn
 * an outage into a mass sign-out.
 */
async function hasActiveAccess(supabase: ReturnType<typeof createServerClient>): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_active_access");
  if (error) {
    console.error("[auth] has_active_access check failed", error);
    return true;
  }
  return data === true;
}

/**
 * `pending` | `rejected` | `active` | `deactivated` for the caller (`public.account_status`), used
 * only after `has_active_access` said no, to tell "waiting for approval" from "access removed".
 * Anything unexpected (error, no profile) is treated as a revoked session, the previous behavior.
 */
async function accountStatus(
  supabase: ReturnType<typeof createServerClient>,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("account_status");
  if (error) {
    console.error("[auth] account_status check failed", error);
    return null;
  }
  return typeof data === "string" ? data : null;
}
