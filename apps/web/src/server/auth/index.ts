"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { safeNextPath } from "@/app/(auth)/_lib/safe-next";
import { createClient } from "@/lib/supabase/server";

/**
 * Real auth contract (replaces `@/server/auth/mock` + `mock-actions` once T1.2b switches its
 * imports over — see docs/ai/WORKFLOW.md §8). Signed-in user as the UI needs it, built from
 * `auth.users` + `profiles`.
 */
export type CurrentUser = {
  id: string;
  email: string;
  /** `profiles.full_name`; `null` → the UI falls back to the email. */
  displayName: string | null;
  /** `profiles.avatar_url` (Google picture); `null` → initials. */
  avatarUrl: string | null;
  isSuperAdmin: boolean;
  /** Signed in through a Space invitation, not through the allowlist. */
  isGuest: boolean;
};

/** Current user, or `null` when signed out. Re-validates the session against Supabase Auth. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name, avatar_url, is_super_admin, is_guest")
    .eq("id", user.id)
    .single();
  if (!profile) return null;

  return {
    id: user.id,
    email: profile.email as string,
    displayName: profile.full_name as string | null,
    avatarUrl: profile.avatar_url as string | null,
    isSuperAdmin: profile.is_super_admin as boolean,
    isGuest: profile.is_guest as boolean,
  };
}

/** Form action of the login page. Reads the `next` field (path to return to after sign-in). */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  const next = safeNextPath(formData.get("next"));
  const origin = (await headers()).get("origin");
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data.url) redirect("/login?error=AUTH_CALLBACK_FAILED");
  redirect(data.url);
}

/** Ends the session and returns to the login page with a "signed out" notice. */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login?signedOut=1");
}
