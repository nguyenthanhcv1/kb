import { cookies } from "next/headers";

/**
 * MOCK of the auth contract that T1.2a (codex-1) will ship in `apps/web/src/server/auth/index.ts`.
 * Fake data only, no real authentication — delete this file (and `mock-actions.ts`) and switch
 * the imports to `@/server/auth` once T1.2a is merged (docs/ai/WORKFLOW.md §8).
 */

/** Signed-in user as the UI needs it (from `auth.users` + `profiles`). */
export type CurrentUser = {
  id: string;
  email: string;
  /** `profiles.display_name`; `null` → the UI falls back to the email. */
  displayName: string | null;
  /** `profiles.avatar_url` (Google picture); `null` → initials. */
  avatarUrl: string | null;
  isSuperAdmin: boolean;
  /** Signed in through a Space invitation, not through the allowlist. */
  isGuest: boolean;
};

/** Cookie standing in for the Supabase session while the real auth is not merged. */
export const MOCK_SESSION_COOKIE = "kb-mock-session";

export const MOCK_USER: CurrentUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "nguyenthanh.cv@gmail.com",
  displayName: "Nguyễn Thành",
  avatarUrl: null,
  isSuperAdmin: true,
  isGuest: false,
};

/** Current user, or `null` when signed out. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  return store.has(MOCK_SESSION_COOKIE) ? MOCK_USER : null;
}
