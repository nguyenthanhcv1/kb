import { describe, expect, it } from "vitest";

import { isValidTimeZone, listTimeZones, normalizeTimeZone } from "./time-zones";

describe("time zones", () => {
  it("validates IANA names", () => {
    expect(isValidTimeZone("Asia/Ho_Chi_Minh")).toBe(true);
    expect(isValidTimeZone("America/Argentina/Buenos_Aires")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Etc/GMT+7")).toBe(true);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("GMT+7")).toBe(false);
    expect(isValidTimeZone("Asia/Atlantis")).toBe(false);
  });

  it("maps legacy ids to current names", () => {
    expect(normalizeTimeZone("Asia/Saigon")).toBe("Asia/Ho_Chi_Minh");
    expect(normalizeTimeZone("Europe/Kiev")).toBe("Europe/Kyiv");
    expect(normalizeTimeZone("Europe/Paris")).toBe("Europe/Paris");
  });

  it("lists every zone once, sorted by offset, including the default and UTC", () => {
    const now = new Date("2026-01-15T00:00:00Z");
    const zones = listTimeZones(now, ["Etc/GMT-14"]);
    const ids = zones.map((z) => z.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("Asia/Ho_Chi_Minh");
    expect(ids).toContain("UTC");
    expect(ids).toContain("Etc/GMT-14");
    expect(ids).not.toContain("Asia/Saigon");
    expect(zones.find((z) => z.id === "Asia/Ho_Chi_Minh")).toMatchObject({
      offset: "GMT+07:00",
      offsetMinutes: 420,
    });
    expect(zones.find((z) => z.id === "UTC")).toMatchObject({
      offset: "GMT+00:00",
      offsetMinutes: 0,
    });
    const offsets = zones.map((z) => z.offsetMinutes);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });
});
