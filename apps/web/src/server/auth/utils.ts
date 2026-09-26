/**
 * Pure helpers behind the auth server (`apps/web/src/middleware.ts`, `src/app/auth/callback`,
 * `src/lib/supabase/env.ts`). No unit test coverage yet — `apps/web` has no Vitest setup (see
 * docs/ai/tasks.yaml T7.1b).
 */

/** True when `pathname` is exactly `path`, or a sub-path of it (`/auth/callback/x`, `/auth/callback`). */
export function isPublicPath(pathname: string, publicPaths: readonly string[]): boolean {
  return publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export type AuthCallbackErrorCode = "AUTH_NOT_ALLOWED" | "AUTH_CALLBACK_FAILED";

/**
 * Maps the `message` on the `AuthApiError` thrown by `exchangeCodeForSession` to a UI error code.
 * `app.before_user_created_hook` (T1.2a migration) sets the hook's `message` field to the error
 * code itself (`AUTH_NOT_ALLOWED`); GoTrue forwards it verbatim as the response's `msg`, which
 * `@supabase/auth-js` puts on `error.message`. Anything else was a transport/API failure.
 */
export function mapAuthCallbackError(message: string): AuthCallbackErrorCode {
  return message === "AUTH_NOT_ALLOWED" ? "AUTH_NOT_ALLOWED" : "AUTH_CALLBACK_FAILED";
}

/** Parses a comma-separated env value (`BOOTSTRAP_SUPER_ADMIN_EMAILS`) into normalized emails. */
export function parseEmailList(value: string | undefined): string[] {
  const emails = (value ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(emails)];
}
