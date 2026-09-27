import {
  PROFILE_VALIDATION_ISSUES,
  updateProfileInputSchema,
  type Profile,
  type ProfileErrorCode,
  type ProfileValidationIssue,
  type UpdateProfileInput,
} from "@/server/profile";

/** Fields of the personal settings forms (keys of {@link UpdateProfileInput}). */
export type ProfileField = keyof UpdateProfileInput;

export type ProfileFormValues = {
  fullName: string;
  avatarUrl: string;
  locale: Profile["locale"];
  timeZone: string;
};

export function profileToFormValues(profile: Profile): ProfileFormValues {
  return {
    fullName: profile.fullName ?? "",
    avatarUrl: profile.avatarUrl ?? "",
    locale: profile.locale,
    timeZone: profile.timeZone,
  };
}

function isIssue(message: string): message is ProfileValidationIssue {
  return (PROFILE_VALIDATION_ISSUES as readonly string[]).includes(message);
}

/**
 * Client-side check with the contract's own zod schema (same rules as the server), one issue code
 * per field — the UI shows `settings.errors.<issue>`.
 */
export function validateProfileInput(
  input: UpdateProfileInput,
): Partial<Record<ProfileField, ProfileValidationIssue>> {
  const result = updateProfileInputSchema.safeParse(input);
  if (result.success) return {};
  const issues: Partial<Record<ProfileField, ProfileValidationIssue>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as ProfileField | undefined;
    if (!field || issues[field]) continue;
    issues[field] = isIssue(issue.message) ? issue.message : fallbackIssue(field);
  }
  return issues;
}

function fallbackIssue(field: ProfileField): ProfileValidationIssue {
  if (field === "fullName") return "nameTooLong";
  if (field === "avatarUrl") return "avatarUrlInvalid";
  if (field === "locale") return "localeInvalid";
  return "timeZoneInvalid";
}

/** Translation key (in the `errors` namespace) for a profile action error code. */
export function profileErrorKey(code: ProfileErrorCode): `errors.${ProfileErrorCode}` {
  return `errors.${code}`;
}

/** URL the avatar preview may load: a trimmed `http(s)` URL, else `null` (initials). */
export function previewAvatarUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return validateProfileInput({ avatarUrl: trimmed }).avatarUrl ? null : trimmed;
}

/** IANA id as a label: `America/Argentina/Buenos_Aires` → `America/Argentina/Buenos Aires`. */
export function timeZoneLabel(id: string): string {
  return id.replaceAll("_", " ");
}
