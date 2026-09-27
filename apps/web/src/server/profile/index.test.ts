import { describe, expect, it } from "vitest";

import { FakeProfileDb, type FakeProfileRow } from "./fake-db";
import { getMyProfile, ProfileError, updateMyProfile, updateProfileInputSchema } from "./index";

const ME = "5d2f0000-0000-4000-8000-000000000002";

function row(overrides: Partial<FakeProfileRow> = {}): FakeProfileRow {
  return {
    id: ME,
    email: "lan@example.com",
    full_name: "Lan Nguyễn",
    avatar_url: null,
    locale: "vi",
    time_zone: "Asia/Ho_Chi_Minh",
    ...overrides,
  };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy(
    (error) => error instanceof ProfileError && error.code === code,
  );
}

describe("updateProfileInputSchema", () => {
  const issue = (input: unknown) =>
    updateProfileInputSchema.safeParse(input).error?.issues.map((i) => i.message);

  it("trims text and turns empty values into null", () => {
    expect(updateProfileInputSchema.parse({ fullName: "  An  ", avatarUrl: " " })).toEqual({
      fullName: "An",
      avatarUrl: null,
    });
    expect(updateProfileInputSchema.parse({ fullName: null })).toEqual({ fullName: null });
  });

  it("rejects long names, non-http avatar URLs, unknown locales and time zones", () => {
    expect(issue({ fullName: "a".repeat(101) })).toEqual(["nameTooLong"]);
    expect(updateProfileInputSchema.safeParse({ fullName: "a".repeat(100) }).success).toBe(true);
    expect(issue({ avatarUrl: "javascript:alert(1)" })).toEqual(["avatarUrlInvalid"]);
    expect(issue({ avatarUrl: "not a url" })).toEqual(["avatarUrlInvalid"]);
    expect(issue({ avatarUrl: `https://x.test/${"a".repeat(2048)}` })).toContain(
      "avatarUrlInvalid",
    );
    expect(issue({ locale: "fr" })).toEqual(["localeInvalid"]);
    expect(issue({ timeZone: "Mars/Olympus_Mons" })).toEqual(["timeZoneInvalid"]);
    expect(issue({ timeZone: "asia/ho_chi_minh" })).toEqual(["timeZoneInvalid"]);
  });

  it("accepts IANA zones and stores legacy ids under their current name", () => {
    expect(updateProfileInputSchema.parse({ timeZone: "Europe/Berlin" })).toEqual({
      timeZone: "Europe/Berlin",
    });
    expect(updateProfileInputSchema.parse({ timeZone: "Asia/Saigon" })).toEqual({
      timeZone: "Asia/Ho_Chi_Minh",
    });
    expect(updateProfileInputSchema.parse({ timeZone: "UTC", locale: "en" })).toEqual({
      timeZone: "UTC",
      locale: "en",
    });
  });
});

describe("getMyProfile", () => {
  it("maps the caller's row", async () => {
    const db = new FakeProfileDb([row()], ME);
    expect(await getMyProfile(db)).toEqual({
      id: ME,
      email: "lan@example.com",
      fullName: "Lan Nguyễn",
      avatarUrl: null,
      locale: "vi",
      timeZone: "Asia/Ho_Chi_Minh",
    });
  });

  it("falls back to the default for an unusable stored time zone", async () => {
    const db = new FakeProfileDb([row({ time_zone: "Nowhere" })], ME);
    expect((await getMyProfile(db)).timeZone).toBe("Asia/Ho_Chi_Minh");
  });

  it("is UNAUTHORIZED when signed out or without a profile", async () => {
    await expectCode(getMyProfile(new FakeProfileDb([row()], null)), "UNAUTHORIZED");
    await expectCode(getMyProfile(new FakeProfileDb([], ME)), "UNAUTHORIZED");
  });
});

describe("updateMyProfile", () => {
  it("writes only the given columns and returns the saved profile", async () => {
    const db = new FakeProfileDb([row()], ME);
    const saved = await updateMyProfile(db, { locale: "en", timeZone: "Europe/Berlin" });
    expect(db.updates).toEqual([{ locale: "en", time_zone: "Europe/Berlin" }]);
    expect(saved).toMatchObject({
      locale: "en",
      timeZone: "Europe/Berlin",
      fullName: "Lan Nguyễn",
    });

    await updateMyProfile(db, { fullName: "", avatarUrl: "https://example.com/a.png" });
    expect(db.updates[1]).toEqual({ full_name: null, avatar_url: "https://example.com/a.png" });
  });

  it("skips the write for an empty patch", async () => {
    const db = new FakeProfileDb([row()], ME);
    expect((await updateMyProfile(db, {})).email).toBe("lan@example.com");
    expect(db.updates).toEqual([]);
  });

  it("validates before touching the database", async () => {
    const db = new FakeProfileDb([row()], ME);
    await expectCode(updateMyProfile(db, { avatarUrl: "ftp://x" }), "VALIDATION_FAILED");
    expect(db.updates).toEqual([]);
  });

  it("maps database errors to codes", async () => {
    const db = new FakeProfileDb([row()], ME);
    db.failUpdate = { code: "23514", message: "check violation" };
    await expectCode(updateMyProfile(db, { locale: "en" }), "VALIDATION_FAILED");
    db.failUpdate = { code: "42501", message: "permission denied" };
    await expectCode(updateMyProfile(db, { locale: "en" }), "UNAUTHORIZED");
    db.failUpdate = { code: "XX000", message: "boom" };
    await expectCode(updateMyProfile(db, { locale: "en" }), "PROFILE_UPDATE_FAILED");
    await expectCode(
      updateMyProfile(new FakeProfileDb([row()], null), { locale: "en" }),
      "UNAUTHORIZED",
    );
  });
});
