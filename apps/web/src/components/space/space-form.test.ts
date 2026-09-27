import enErrors from "@kb/i18n/messages/en/errors.json";
import viErrors from "@kb/i18n/messages/vi/errors.json";
import { describe, expect, it } from "vitest";

import { SPACE_ERROR_CODES, type SpaceErrorCode } from "@/server/space";

import { isSlugError, spaceErrorKey } from "./errors";
import { canCreateSpace, canEditSpaceContent, canManageSpace } from "./permissions";
import { EMPTY_SPACE_FORM, formValuesToInput, validateSpaceForm } from "./space-form";

describe("validateSpaceForm", () => {
  it("defaults new Spaces to restricted", () => {
    expect(EMPTY_SPACE_FORM.visibility).toBe("restricted");
  });

  it("reports a blank name, an invalid slug and a too-long icon", () => {
    expect(
      validateSpaceForm({ ...EMPTY_SPACE_FORM, name: "  ", slug: "A", icon: "123456789" }),
    ).toEqual({ name: "nameRequired", slug: "slugInvalid", icon: "iconTooLong" });
  });

  it("accepts a valid form, including a multi-code-point emoji icon", () => {
    expect(
      validateSpaceForm({ ...EMPTY_SPACE_FORM, name: "Kỹ thuật", slug: "ky-thuat", icon: "👩‍💻" }),
    ).toEqual({});
  });
});

describe("formValuesToInput", () => {
  it("trims and stores empty icon/description as null", () => {
    expect(
      formValuesToInput({
        name: "  Design ",
        slug: "design",
        icon: " ",
        description: "",
        visibility: "internal",
      }),
    ).toEqual({
      name: "Design",
      slug: "design",
      icon: null,
      description: null,
      visibility: "internal",
    });
  });
});

describe("spaceErrorKey", () => {
  it.each(SPACE_ERROR_CODES)("%s has a message in vi and en", (code) => {
    const key = spaceErrorKey(code);
    expect(key).toBe(`errors.${code}`);
    expect(viErrors[code]).toBeTruthy();
    expect(enErrors[code]).toBeTruthy();
  });

  it("falls back to SPACE_WRITE_FAILED for an unexpected code", () => {
    expect(spaceErrorKey("SOMETHING_ELSE" as SpaceErrorCode)).toBe("errors.SPACE_WRITE_FAILED");
  });

  it("shows only the duplicate slug next to the slug field", () => {
    expect(isSlugError("SPACE_SLUG_TAKEN")).toBe(true);
    expect(isSlugError("FORBIDDEN")).toBe(false);
  });
});

describe("permissions", () => {
  it("lets only internal users create Spaces", () => {
    expect(canCreateSpace({ isGuest: false })).toBe(true);
    expect(canCreateSpace({ isGuest: true })).toBe(false);
    expect(canCreateSpace(null)).toBe(false);
  });

  it.each([
    ["admin", true, true],
    ["editor", false, true],
    ["viewer", false, false],
    [null, false, false],
  ] as const)("role %s: manage %s, edit content %s", (role, manage, edit) => {
    expect(canManageSpace(role)).toBe(manage);
    expect(canEditSpaceContent(role)).toBe(edit);
  });
});
