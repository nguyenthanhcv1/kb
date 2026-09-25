"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { safeNextPath } from "@/app/(auth)/_lib/safe-next";

import { MOCK_SESSION_COOKIE } from "./mock";

/**
 * MOCK server actions of the T1.2a auth contract (see `mock.ts`).
 * Real `signInWithGoogle` starts Supabase `signInWithOAuth({ provider: "google" })` and redirects
 * to Google; the callback then redirects to `next`, or to `/access-denied` for `AUTH_NOT_ALLOWED`.
 */

/** Form action of the login page. Reads the `next` field (path to return to after sign-in). */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  (await cookies()).set(MOCK_SESSION_COOKIE, "1", { path: "/", httpOnly: true, sameSite: "lax" });
  redirect(safeNextPath(formData.get("next")));
}

/** Ends the session and returns to the login page with a "signed out" notice. */
export async function signOut(): Promise<void> {
  (await cookies()).delete(MOCK_SESSION_COOKIE);
  redirect("/login?signedOut=1");
}
