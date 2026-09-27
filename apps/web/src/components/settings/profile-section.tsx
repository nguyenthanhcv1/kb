"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";

import { initials } from "@/components/layout/user-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PROFILE_AVATAR_URL_MAX_LENGTH,
  PROFILE_NAME_MAX_LENGTH,
  type Profile,
  type ProfileErrorCode,
} from "@/server/profile";
import { updateMyProfile } from "@/server/profile/actions";

import { FieldError, SectionCard, SubmitRow } from "./form-parts";
import { previewAvatarUrl, profileErrorKey, validateProfileInput } from "./profile-form";

/** Settings › Profile: display name and avatar URL (email comes from Google and is read-only). */
export function ProfileSection({ profile }: { profile: Profile }) {
  const t = useTranslations();
  const router = useRouter();
  const idPrefix = useId();
  const id = (field: string) => `${idPrefix}-${field}`;
  const [fullName, setFullName] = useState(profile.fullName ?? "");
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl ?? "");
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<ProfileErrorCode | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const input = { fullName, avatarUrl };
  const issues = validateProfileInput(input);
  const nameError = submitted && issues.fullName;
  const avatarError = submitted && issues.avatarUrl;
  const preview = previewAvatarUrl(avatarUrl);

  function edited() {
    setSaved(false);
    setServerError(null);
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    edited();
    if (Object.keys(issues).length > 0) return;
    startTransition(async () => {
      const result = await updateMyProfile(input);
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      setFullName(result.data.fullName ?? "");
      setAvatarUrl(result.data.avatarUrl ?? "");
      setSubmitted(false);
      setSaved(true);
      // The top bar avatar and name come from the server layout.
      router.refresh();
    });
  }

  return (
    <SectionCard
      titleId="settings-profile"
      title={t("settings.profile.title")}
      description={t("settings.profile.description")}
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-5">
        {serverError && (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {t(profileErrorKey(serverError))}
          </p>
        )}

        <div className="flex items-center gap-4">
          <Avatar className="size-16 text-lg">
            {preview && <AvatarImage src={preview} alt="" referrerPolicy="no-referrer" />}
            <AvatarFallback className="font-medium">
              {initials({ displayName: fullName || null, email: profile.email })}
            </AvatarFallback>
          </Avatar>
          <div className="grid min-w-0 gap-0.5 text-sm">
            <span className="truncate font-medium">{fullName.trim() || profile.email}</span>
            <span className="truncate text-muted-foreground">{profile.email}</span>
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor={id("name")}>{t("settings.profile.displayName")}</Label>
          <Input
            id={id("name")}
            name="fullName"
            value={fullName}
            onChange={(event) => {
              edited();
              setFullName(event.target.value);
            }}
            placeholder={t("settings.profile.displayNamePlaceholder")}
            autoComplete="name"
            disabled={pending}
            aria-invalid={Boolean(nameError)}
            aria-describedby={[id("name-hint"), nameError ? id("name-error") : null]
              .filter(Boolean)
              .join(" ")}
          />
          <p id={id("name-hint")} className="text-xs text-muted-foreground">
            {t("settings.profile.displayNameHint")}
          </p>
          <FieldError
            id={id("name-error")}
            message={
              nameError
                ? t(`settings.errors.${nameError}`, { max: PROFILE_NAME_MAX_LENGTH })
                : undefined
            }
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor={id("avatar")}>{t("settings.profile.avatarUrl")}</Label>
          <Input
            id={id("avatar")}
            name="avatarUrl"
            type="url"
            inputMode="url"
            value={avatarUrl}
            onChange={(event) => {
              edited();
              setAvatarUrl(event.target.value);
            }}
            placeholder={t("settings.profile.avatarUrlPlaceholder")}
            autoComplete="photo"
            spellCheck={false}
            maxLength={PROFILE_AVATAR_URL_MAX_LENGTH}
            disabled={pending}
            aria-invalid={Boolean(avatarError)}
            aria-describedby={[id("avatar-hint"), avatarError ? id("avatar-error") : null]
              .filter(Boolean)
              .join(" ")}
          />
          <p id={id("avatar-hint")} className="text-xs text-muted-foreground">
            {t("settings.profile.avatarUrlHint")}
          </p>
          <FieldError
            id={id("avatar-error")}
            message={
              avatarError
                ? t(`settings.errors.${avatarError}`, { max: PROFILE_NAME_MAX_LENGTH })
                : undefined
            }
          />
        </div>

        <SubmitRow pending={pending} saved={saved} />
      </form>
    </SectionCard>
  );
}
