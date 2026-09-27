"use client";

import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { SPACE_VISIBILITIES, type SpaceVisibility } from "@/server/space";

import { SPACE_SLUG_MAX_LENGTH, normalizeSlugInput } from "./slug";
import type { SpaceFormField, SpaceFormValues } from "./space-form";

/** URL prefix of Space pages, shown before the slug input (not text: a path). */
const SPACE_PATH_PREFIX = "/s/";

type SpaceFormFieldsProps = {
  /** Prefix for element ids, unique per form on the page. */
  idPrefix: string;
  values: SpaceFormValues;
  onChange: <F extends SpaceFormField>(field: F, value: SpaceFormValues[F]) => void;
  /** Translated message per field, shown under it and linked with `aria-describedby`. */
  errors: Partial<Record<SpaceFormField, string>>;
  disabled?: boolean;
};

/** Name, slug, icon, description and visibility inputs shared by the create dialog and settings. */
export function SpaceFormFields({
  idPrefix,
  values,
  onChange,
  errors,
  disabled,
}: SpaceFormFieldsProps) {
  const t = useTranslations("space");
  const id = (field: string) => `${idPrefix}-${field}`;
  const describedBy = (field: SpaceFormField, hint = false) =>
    [errors[field] ? id(`${field}-error`) : null, hint ? id(`${field}-hint`) : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <Label htmlFor={id("name")}>{t("form.name")}</Label>
        <Input
          id={id("name")}
          name="name"
          value={values.name}
          onChange={(event) => onChange("name", event.target.value)}
          placeholder={t("form.namePlaceholder")}
          autoComplete="off"
          required
          disabled={disabled}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={describedBy("name")}
        />
        <FieldError id={id("name-error")} message={errors.name} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={id("slug")}>{t("form.slug")}</Label>
        <div className="flex items-center rounded-md border border-input shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 has-[[aria-invalid=true]]:border-destructive">
          <span className="pl-3 text-sm text-muted-foreground select-none" aria-hidden>
            {SPACE_PATH_PREFIX}
          </span>
          <Input
            id={id("slug")}
            name="slug"
            value={values.slug}
            onChange={(event) => onChange("slug", normalizeSlugInput(event.target.value))}
            maxLength={SPACE_SLUG_MAX_LENGTH}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            disabled={disabled}
            className="border-0 pl-0.5 shadow-none focus-visible:ring-0"
            aria-invalid={Boolean(errors.slug)}
            aria-describedby={describedBy("slug", true)}
          />
        </div>
        <p id={id("slug-hint")} className="text-xs text-muted-foreground">
          {t("form.slugHint", { slug: values.slug || "…" })}
        </p>
        <FieldError id={id("slug-error")} message={errors.slug} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={id("icon")}>
          {t("form.icon")}{" "}
          <span className="font-normal text-muted-foreground">({t("form.optional")})</span>
        </Label>
        <Input
          id={id("icon")}
          name="icon"
          value={values.icon}
          onChange={(event) => onChange("icon", event.target.value)}
          autoComplete="off"
          disabled={disabled}
          className="w-24 text-center text-lg"
          aria-invalid={Boolean(errors.icon)}
          aria-describedby={describedBy("icon", true)}
        />
        <p id={id("icon-hint")} className="text-xs text-muted-foreground">
          {t("form.iconHint")}
        </p>
        <FieldError id={id("icon-error")} message={errors.icon} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={id("description")}>
          {t("form.description")}{" "}
          <span className="font-normal text-muted-foreground">({t("form.optional")})</span>
        </Label>
        <Textarea
          id={id("description")}
          name="description"
          value={values.description}
          onChange={(event) => onChange("description", event.target.value)}
          placeholder={t("form.descriptionPlaceholder")}
          rows={3}
          disabled={disabled}
        />
      </div>

      <fieldset className="grid gap-3">
        <legend className="mb-2 text-sm leading-none font-medium">{t("form.visibility")}</legend>
        <RadioGroup
          value={values.visibility}
          onValueChange={(value) => onChange("visibility", value as SpaceVisibility)}
          disabled={disabled}
          className="gap-2"
        >
          {SPACE_VISIBILITIES.map((visibility) => (
            <Label
              key={visibility}
              htmlFor={id(`visibility-${visibility}`)}
              className="flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/50"
            >
              <RadioGroupItem
                id={id(`visibility-${visibility}`)}
                value={visibility}
                className="mt-0.5"
                aria-describedby={id(`visibility-${visibility}-hint`)}
              />
              <span className="grid gap-1">
                <span className="font-medium">{t(`visibility.${visibility}`)}</span>
                <span
                  id={id(`visibility-${visibility}-hint`)}
                  className="text-xs leading-snug text-muted-foreground"
                >
                  {t(`form.visibilityHint.${visibility}`)}
                </span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </fieldset>
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  );
}
