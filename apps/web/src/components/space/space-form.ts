import type { Space, SpaceVisibility } from "@/server/space";

import { isValidSpaceSlug } from "./slug";

/** Editable fields of a Space, as the create dialog and the settings form hold them. */
export type SpaceFormValues = {
  name: string;
  slug: string;
  icon: string;
  description: string;
  visibility: SpaceVisibility;
};

export type SpaceFormField = keyof SpaceFormValues;

/** Keys under `space.form` of the client-side validation messages. */
export type SpaceFormIssue = "nameRequired" | "slugInvalid" | "iconTooLong";

/** An icon is one emoji (possibly several code points, e.g. 👩‍💻) or a few characters. */
export const SPACE_ICON_MAX_CODE_POINTS = 8;

/** New Spaces are `restricted` by default: only the creator (admin) sees them at first. */
export const EMPTY_SPACE_FORM: SpaceFormValues = {
  name: "",
  slug: "",
  icon: "",
  description: "",
  visibility: "restricted",
};

export function spaceToFormValues(space: Space): SpaceFormValues {
  return {
    name: space.name,
    slug: space.slug,
    icon: space.icon ?? "",
    description: space.description ?? "",
    visibility: space.visibility,
  };
}

/** Same rules as the contract's zod schemas, checked before calling the server. */
export function validateSpaceForm(
  values: SpaceFormValues,
): Partial<Record<SpaceFormField, SpaceFormIssue>> {
  const issues: Partial<Record<SpaceFormField, SpaceFormIssue>> = {};
  if (values.name.trim().length === 0) issues.name = "nameRequired";
  if (!isValidSpaceSlug(values.slug)) issues.slug = "slugInvalid";
  if (Array.from(values.icon.trim()).length > SPACE_ICON_MAX_CODE_POINTS)
    issues.icon = "iconTooLong";
  return issues;
}

/** Form values → contract input (trimmed; empty icon/description are stored as `null`). */
export function formValuesToInput(values: SpaceFormValues) {
  return {
    name: values.name.trim(),
    slug: values.slug,
    icon: values.icon.trim() || null,
    description: values.description.trim() || null,
    visibility: values.visibility,
  };
}
