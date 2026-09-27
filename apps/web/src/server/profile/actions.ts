"use server";

import { isLocale, localeCookieName, type Locale } from "@kb/i18n/config";
import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";

import {
  ProfileError,
  getMyProfile as getMyProfileCore,
  updateMyProfile as updateMyProfileCore,
  type Profile,
  type ProfileDb,
  type ProfileErrorCode,
  type UpdateProfileInput,
} from "./index";
import { hasSessionCookie } from "./request";

/**
 * Server Action wrappers of the personal settings contract (`./index.ts`). Results are plain
 * objects (Server Actions cannot send thrown errors to the client). A saved locale is also
 * written to the `NEXT_LOCALE` cookie, so signed-out screens on this device (login after
 * sign-out) keep the language; signed-in requests read `profiles.locale` first (`./request.ts`).
 */
export type ProfileActionResult<T> = { ok: true; data: T } | { ok: false; error: ProfileErrorCode };

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

async function runAction<T>(run: () => Promise<T>): Promise<ProfileActionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    if (error instanceof ProfileError) return { ok: false, error: error.code };
    throw error;
  }
}

/** Narrows supabase-js' deeply generic client to the structural contract (see space/actions.ts). */
function asProfileDb(client: Awaited<ReturnType<typeof createClient>>): ProfileDb {
  return client as unknown as ProfileDb;
}

async function writeLocaleCookie(locale: Locale) {
  (await cookies()).set(localeCookieName, locale, {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
  });
}

export async function getMyProfile(): Promise<ProfileActionResult<Profile>> {
  return runAction(async () => getMyProfileCore(asProfileDb(await createClient())));
}

export async function updateMyProfile(
  input: UpdateProfileInput,
): Promise<ProfileActionResult<Profile>> {
  return runAction(async () => {
    const profile = await updateMyProfileCore(asProfileDb(await createClient()), input);
    if (input.locale !== undefined) await writeLocaleCookie(profile.locale);
    return profile;
  });
}

/**
 * Language switcher (top bar, login screen). Always sets the cookie; when signed in, also saves
 * `profiles.locale` so the choice follows the user to other devices. `saved` tells which.
 *
 * @returns `VALIDATION_FAILED` for an unknown locale, `PROFILE_UPDATE_FAILED` when the profile
 *   could not be saved (the cookie is set anyway, but the profile value keeps winning).
 */
export async function setLocale(
  locale: Locale,
): Promise<ProfileActionResult<{ locale: Locale; saved: boolean }>> {
  if (!isLocale(locale)) return { ok: false, error: "VALIDATION_FAILED" };
  await writeLocaleCookie(locale);
  const cookieNames = (await cookies()).getAll().map((cookie) => cookie.name);
  if (!hasSessionCookie(cookieNames)) return { ok: true, data: { locale, saved: false } };
  return runAction(async () => {
    const supabase = asProfileDb(await createClient());
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { locale, saved: false };
    await updateMyProfileCore(supabase, { locale });
    return { locale, saved: true };
  });
}
