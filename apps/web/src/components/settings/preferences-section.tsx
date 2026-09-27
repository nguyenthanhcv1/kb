"use client";

import { locales, type Locale } from "@kb/i18n/config";
import { LocateFixedIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { Profile, ProfileErrorCode } from "@/server/profile";
import { updateMyProfile } from "@/server/profile/actions";
import {
  isValidTimeZone,
  normalizeTimeZone,
  type TimeZoneOption,
} from "@/server/profile/time-zones";

import { FieldError, SectionCard, SubmitRow } from "./form-parts";
import { profileErrorKey, timeZoneLabel, validateProfileInput } from "./profile-form";

/** Time zone reported by this browser, as a current IANA name (`null` if unknown/unsupported). */
function deviceTimeZone(): string | null {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!zone) return null;
  const normalized = normalizeTimeZone(zone);
  return isValidTimeZone(normalized) ? normalized : null;
}

/**
 * Settings › Language and time zone. Saving writes `profiles.locale` / `profiles.time_zone` (and
 * the `NEXT_LOCALE` cookie), then re-renders the whole app in the new language and time zone.
 * `timeZones` is built on the server (offsets depend on the date) so SSR and hydration agree.
 */
export function PreferencesSection({
  profile,
  timeZones,
}: {
  profile: Profile;
  timeZones: TimeZoneOption[];
}) {
  const t = useTranslations();
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const router = useRouter();
  const idPrefix = useId();
  const id = (field: string) => `${idPrefix}-${field}`;
  const [locale, setLocale] = useState<Locale>(profile.locale);
  const [timeZone, setTimeZone] = useState(profile.timeZone);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<ProfileErrorCode | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  // The language may also change from the top bar switcher: follow the saved values when they
  // change on the server (adjusting state during render, no effect needed).
  const [savedValues, setSavedValues] = useState({
    locale: profile.locale,
    timeZone: profile.timeZone,
  });
  if (savedValues.locale !== profile.locale || savedValues.timeZone !== profile.timeZone) {
    setSavedValues({ locale: profile.locale, timeZone: profile.timeZone });
    setLocale(profile.locale);
    setTimeZone(profile.timeZone);
  }

  const input = { locale, timeZone };
  const issues = validateProfileInput(input);
  const timeZoneError = submitted && issues.timeZone;
  const options = timeZones.some((zone) => zone.id === timeZone)
    ? timeZones
    : [{ id: timeZone, offset: "", offsetMinutes: 0 }, ...timeZones];

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
      setSubmitted(false);
      setSaved(true);
      router.refresh();
    });
  }

  function applyDeviceTimeZone() {
    const zone = deviceTimeZone();
    if (!zone) return;
    edited();
    setTimeZone(zone);
  }

  return (
    <SectionCard
      titleId="settings-preferences"
      title={t("settings.preferences.title")}
      description={t("settings.preferences.description")}
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-6">
        {serverError && (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {t(profileErrorKey(serverError))}
          </p>
        )}

        <fieldset className="grid gap-3">
          <legend className="mb-2 text-sm leading-none font-medium">
            {t("settings.language.label")}
          </legend>
          <RadioGroup
            value={locale}
            onValueChange={(value) => {
              const next = locales.find((l) => l === value);
              if (!next) return;
              edited();
              setLocale(next);
            }}
            disabled={pending}
            aria-describedby={id("language-hint")}
            className="grid gap-2 sm:grid-cols-2"
          >
            {locales.map((value) => (
              <Label
                key={value}
                htmlFor={id(`locale-${value}`)}
                className="flex cursor-pointer items-center gap-3 rounded-md border p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/50"
              >
                <RadioGroupItem id={id(`locale-${value}`)} value={value} />
                <span lang={value} className="font-medium">
                  {t(`common.locale.names.${value}`)}
                </span>
              </Label>
            ))}
          </RadioGroup>
          <p id={id("language-hint")} className="text-xs text-muted-foreground">
            {t("settings.language.hint")}
          </p>
        </fieldset>

        <div className="grid gap-2">
          <Label htmlFor={id("time-zone")}>{t("settings.timeZone.label")}</Label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <NativeSelect
              id={id("time-zone")}
              name="timeZone"
              value={timeZone}
              onChange={(event) => {
                edited();
                setTimeZone(event.target.value);
              }}
              disabled={pending}
              className="w-full sm:w-80"
              aria-invalid={Boolean(timeZoneError)}
              aria-describedby={[id("time-zone-hint"), timeZoneError ? id("time-zone-error") : null]
                .filter(Boolean)
                .join(" ")}
            >
              {options.map((zone) => (
                <NativeSelectOption key={zone.id} value={zone.id}>
                  {zone.offset
                    ? t("settings.timeZone.option", {
                        offset: zone.offset,
                        zone: timeZoneLabel(zone.id),
                      })
                    : timeZoneLabel(zone.id)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button
              type="button"
              variant="outline"
              onClick={applyDeviceTimeZone}
              disabled={pending}
              className="sm:w-auto"
            >
              <LocateFixedIcon aria-hidden />
              {t("settings.timeZone.useDevice")}
            </Button>
          </div>
          <p id={id("time-zone-hint")} className="text-xs text-muted-foreground" aria-live="polite">
            {isValidTimeZone(timeZone)
              ? t("settings.timeZone.preview", {
                  time: format.dateTime(now, { dateStyle: "medium", timeStyle: "short", timeZone }),
                })
              : null}
          </p>
          <FieldError
            id={id("time-zone-error")}
            message={timeZoneError ? t(`settings.errors.${timeZoneError}`) : undefined}
          />
        </div>

        <SubmitRow pending={pending} saved={saved} />
      </form>
    </SectionCard>
  );
}
