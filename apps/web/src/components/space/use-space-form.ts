"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import type { SpaceErrorCode } from "@/server/space";

import { isSlugError, spaceErrorKey } from "./errors";
import { deriveSpaceSlug } from "./slug";
import { validateSpaceForm, type SpaceFormField, type SpaceFormValues } from "./space-form";

/**
 * Form state shared by the create dialog and the settings form: values, client-side validation
 * (shown once the user tried to submit), the server error code of the last attempt and — for
 * the create dialog — a slug that follows the name until the user edits it.
 */
export function useSpaceForm(initial: SpaceFormValues, { autoSlug }: { autoSlug: boolean }) {
  const t = useTranslations();
  const [values, setValues] = useState(initial);
  const [slugEdited, setSlugEdited] = useState(!autoSlug);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<SpaceErrorCode | null>(null);

  const issues = validateSpaceForm(values);
  const errors: Partial<Record<SpaceFormField, string>> = {};
  if (submitted) {
    for (const [field, issue] of Object.entries(issues) as [SpaceFormField, string][]) {
      errors[field] = t(`space.form.${issue as "nameRequired" | "slugInvalid" | "iconTooLong"}`);
    }
  }
  if (serverError && isSlugError(serverError) && !errors.slug) {
    errors.slug = t(spaceErrorKey(serverError));
  }
  const formError = serverError && !isSlugError(serverError) ? t(spaceErrorKey(serverError)) : null;

  function onChange<F extends SpaceFormField>(field: F, value: SpaceFormValues[F]) {
    setServerError(null);
    setValues((current) => {
      const next = { ...current, [field]: value };
      if (field === "name" && !slugEdited) next.slug = deriveSpaceSlug(String(value));
      return next;
    });
    if (field === "slug") setSlugEdited(true);
  }

  /** Marks the form as submitted; returns whether the values can be sent to the server. */
  function beginSubmit(): boolean {
    setSubmitted(true);
    setServerError(null);
    return Object.keys(issues).length === 0;
  }

  function reset(next: SpaceFormValues = initial) {
    setValues(next);
    setSlugEdited(!autoSlug);
    setSubmitted(false);
    setServerError(null);
  }

  return { values, errors, formError, onChange, beginSubmit, setServerError, reset };
}
