import type { Locale } from "@kb/i18n/config";
import { cookies } from "next/headers";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

import { ProfileError, getMyProfile, type ProfileDb } from "./index";

/**
 * `@supabase/ssr` session cookie: `sb-<project ref>-auth-token`, split into `.0`, `.1`… chunks
 * when large. Its presence only means "maybe signed in" — the profile read below is what checks
 * the session (GoTrue `getUser` + RLS).
 */
const SESSION_COOKIE = /^sb-[^.]+-auth-token(?:\.\d+)?$/;

export function hasSessionCookie(names: Iterable<string>): boolean {
  for (const name of names) if (SESSION_COOKIE.test(name)) return true;
  return false;
}

export type RequestPreferences = { locale: Locale; timeZone: string };

/**
 * Locale and time zone saved in the signed-in user's profile, for `src/i18n/request.ts`
 * (profile → `NEXT_LOCALE` cookie → `Accept-Language`). `null` when signed out — without a
 * session cookie no Supabase call is made — or when the profile cannot be read (the page then
 * renders in the cookie/header locale instead of failing). Cached per request.
 */
export const getRequestPreferences = cache(async (): Promise<RequestPreferences | null> => {
  const cookieStore = await cookies();
  if (!hasSessionCookie(cookieStore.getAll().map((cookie) => cookie.name))) return null;
  try {
    const supabase = (await createClient()) as unknown as ProfileDb;
    const { locale, timeZone } = await getMyProfile(supabase);
    return { locale, timeZone };
  } catch (error) {
    if (!(error instanceof ProfileError && error.code === "UNAUTHORIZED")) {
      console.error("[profile] reading locale/time zone failed", error);
    }
    return null;
  }
});
