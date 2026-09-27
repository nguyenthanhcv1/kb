import { defaultTimeZone, locales, type Locale } from "@kb/i18n/config";
import { z } from "zod";

import { isValidTimeZone, normalizeTimeZone } from "./time-zones";

/**
 * Personal settings contract (task T1.3, docs/PLAN.md §3.2 `profiles`): the signed-in user's own
 * display name, avatar, UI language and time zone.
 *
 * Every function takes a caller-scoped Supabase client (`@/lib/supabase/server`'s `createClient()`):
 * `profiles_select` / `profiles_update` RLS and the column-level UPDATE grant
 * (`full_name, avatar_url, locale, time_zone` only) decide what the caller may touch — this
 * module validates input, maps rows and turns Postgres errors into stable codes.
 *
 * ```ts
 * const profile = await getMyProfile(supabase);
 * // → { id: "5d2f…", email: "lan@example.com", fullName: "Lan Nguyễn", avatarUrl: null,
 * //     locale: "vi", timeZone: "Asia/Ho_Chi_Minh" }
 * await updateMyProfile(supabase, { locale: "en", timeZone: "Europe/Berlin" });
 * await updateMyProfile(supabase, { fullName: "", avatarUrl: "" }); // clears both (→ null)
 * ```
 *
 * The Server Action wrappers (`./actions.ts`) also keep the `NEXT_LOCALE` cookie in sync;
 * `src/i18n/request.ts` reads locale and time zone through `./request.ts`.
 *
 * Errors: `errors.<ProfileErrorCode>` (see {@link PROFILE_ERROR_CODES}).
 */

export const PROFILE_ERROR_CODES = [
  "PROFILE_UPDATE_FAILED",
  "UNAUTHORIZED",
  "VALIDATION_FAILED",
] as const;
export type ProfileErrorCode = (typeof PROFILE_ERROR_CODES)[number];

export class ProfileError extends Error {
  constructor(
    readonly code: ProfileErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = "ProfileError";
  }
}

export const PROFILE_NAME_MAX_LENGTH = 100;
export const PROFILE_AVATAR_URL_MAX_LENGTH = 2048;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Trims; an empty string (or `null`) clears the column. */
const clearableText = z
  .string()
  .nullable()
  .transform((value) => value?.trim() || null);

/** Validation issue messages are stable codes, mapped to `settings.profile.errors.*` by the UI. */
export const PROFILE_VALIDATION_ISSUES = [
  "nameTooLong",
  "avatarUrlInvalid",
  "localeInvalid",
  "timeZoneInvalid",
] as const;
export type ProfileValidationIssue = (typeof PROFILE_VALIDATION_ISSUES)[number];

export const updateProfileInputSchema = z.object({
  /** `profiles.full_name`; `""`/`null` → `null` (the UI then shows the email). */
  fullName: clearableText
    .pipe(z.string().max(PROFILE_NAME_MAX_LENGTH, "nameTooLong").nullable())
    .optional(),
  /** `profiles.avatar_url`: an `http(s)` image URL; `""`/`null` → `null` (initials). */
  avatarUrl: clearableText
    .pipe(
      z
        .string()
        .max(PROFILE_AVATAR_URL_MAX_LENGTH, "avatarUrlInvalid")
        .refine(isHttpUrl, "avatarUrlInvalid")
        .nullable(),
    )
    .optional(),
  locale: z.enum(locales, "localeInvalid").optional(),
  /** IANA name (`Asia/Ho_Chi_Minh`); legacy ids are stored under their current name. */
  timeZone: z
    .string()
    .trim()
    .transform(normalizeTimeZone)
    .refine(isValidTimeZone, "timeZoneInvalid")
    .optional(),
});
export type UpdateProfileInput = z.input<typeof updateProfileInputSchema>;

export const profileSchema = z.object({
  id: z.guid(),
  email: z.string(),
  fullName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  locale: z.enum(locales),
  timeZone: z.string(),
});
export type Profile = z.infer<typeof profileSchema>;

/** Example output — base for UI mocks and tests. */
export const profileExample: Profile = {
  id: "5d2f0000-0000-4000-8000-000000000002",
  email: "lan@example.com",
  fullName: "Lan Nguyễn",
  avatarUrl: "https://lh3.googleusercontent.com/a/example",
  locale: "vi",
  timeZone: "Asia/Ho_Chi_Minh",
};

const PROFILE_COLUMNS = "id, email, full_name, avatar_url, locale, time_zone";

const profileRowSchema = z.object({
  id: z.guid(),
  email: z.string(),
  full_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  locale: z.string(),
  time_zone: z.string(),
});

function mapProfileRow(row: z.infer<typeof profileRowSchema>): Profile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    // DB check keeps locale in ('vi', 'en'); time_zone has no DB check, so an invalid legacy value
    // falls back to the default rather than breaking every date on the page.
    locale: (locales as readonly string[]).includes(row.locale) ? (row.locale as Locale) : "vi",
    timeZone: isValidTimeZone(normalizeTimeZone(row.time_zone))
      ? normalizeTimeZone(row.time_zone)
      : defaultTimeZone,
  };
}

interface PostgrestError {
  code?: string;
  message: string;
}
interface PostgrestSingleResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

/** Chainable subset of the PostgREST builders used here (a real `SupabaseClient` satisfies it). */
export interface ProfileRowsQuery {
  eq(column: string, value: string): ProfileRowsQuery;
  select<Columns extends string>(columns: Columns): ProfileRowsQuery;
  maybeSingle(): PromiseLike<PostgrestSingleResult<unknown>>;
}

export interface ProfileTableQuery {
  select<Columns extends string>(columns: Columns): ProfileRowsQuery;
  update(row: Record<string, unknown>): ProfileRowsQuery;
}

/** The part of a Supabase client this module needs. */
export interface ProfileDb {
  auth: {
    getUser(): PromiseLike<{ data: { user: { id: string } | null } }>;
  };
  from(table: "profiles"): ProfileTableQuery;
}

const PG_CHECK_VIOLATION = "23514";
const PG_INSUFFICIENT_PRIVILEGE = "42501";

async function requireUserId(db: ProfileDb): Promise<string> {
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new ProfileError("UNAUTHORIZED");
  return user.id;
}

/**
 * The signed-in user's profile.
 *
 * @throws {ProfileError} `UNAUTHORIZED` (signed out, or no profile row), `PROFILE_UPDATE_FAILED`
 *   (query failed).
 */
export async function getMyProfile(db: ProfileDb): Promise<Profile> {
  const userId = await requireUserId(db);
  const { data, error } = await db
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new ProfileError("PROFILE_UPDATE_FAILED", { cause: error });
  if (!data) throw new ProfileError("UNAUTHORIZED");
  return mapProfileRow(profileRowSchema.parse(data));
}

/**
 * Updates any of the caller's own name, avatar, locale and time zone (omitted fields are kept).
 * Returns the saved profile.
 *
 * @throws {ProfileError} `VALIDATION_FAILED`, `UNAUTHORIZED`, `PROFILE_UPDATE_FAILED`.
 */
export async function updateMyProfile(db: ProfileDb, input: UpdateProfileInput): Promise<Profile> {
  const parsed = updateProfileInputSchema.safeParse(input);
  if (!parsed.success) throw new ProfileError("VALIDATION_FAILED", { cause: parsed.error });
  const userId = await requireUserId(db);

  const patch: Record<string, unknown> = {};
  if (parsed.data.fullName !== undefined) patch.full_name = parsed.data.fullName;
  if (parsed.data.avatarUrl !== undefined) patch.avatar_url = parsed.data.avatarUrl;
  if (parsed.data.locale !== undefined) patch.locale = parsed.data.locale;
  if (parsed.data.timeZone !== undefined) patch.time_zone = parsed.data.timeZone;
  if (Object.keys(patch).length === 0) return getMyProfile(db);

  const { data, error } = await db
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select(PROFILE_COLUMNS)
    .maybeSingle();
  if (error) {
    if (error.code === PG_CHECK_VIOLATION)
      throw new ProfileError("VALIDATION_FAILED", { cause: error });
    if (error.code === PG_INSUFFICIENT_PRIVILEGE)
      throw new ProfileError("UNAUTHORIZED", { cause: error });
    throw new ProfileError("PROFILE_UPDATE_FAILED", { cause: error });
  }
  if (!data) throw new ProfileError("UNAUTHORIZED");
  return mapProfileRow(profileRowSchema.parse(data));
}
