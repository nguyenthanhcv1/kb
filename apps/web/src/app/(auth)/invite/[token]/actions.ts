"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { safeNextPath } from "../../_lib/safe-next";

/**
 * "Sign out and switch account" on `/invite/<token>` when the invitation is for another email:
 * ends the session and returns to the login page, which comes back to the invitation.
 */
export async function switchAccountForInvitation(formData: FormData): Promise<void> {
  const token = formData.get("token");
  const next = safeNextPath(
    typeof token === "string" ? `/invite/${encodeURIComponent(token)}` : "/",
  );
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/login?next=${encodeURIComponent(next)}`);
}
