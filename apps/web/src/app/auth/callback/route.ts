import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/app/(auth)/_lib/safe-next";
import { publicOrigin } from "@/lib/public-origin";
import { createClient } from "@/lib/supabase/server";
import { mapAuthCallbackError } from "@/server/auth/utils";

/**
 * Google OAuth redirect target (`redirectTo` in `signInWithGoogle`). Exchanges the `code` for a
 * session; `app.before_user_created_hook` (T1.2a migration) already decided at the Postgres
 * level whether this email may sign up at all, so a rejection surfaces here as an auth error
 * whose `message` is the error code itself (`AUTH_NOT_ALLOWED`) — see supabase/auth's
 * `hookserrors` package, which forwards the hook's `message` field verbatim as `msg`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const origin = publicOrigin(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=AUTH_CALLBACK_FAILED`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${mapAuthCallbackError(error.message)}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
