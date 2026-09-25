import { describe, expect, it } from "vitest";

import { matchAcceptLanguage, resolveLocale } from "./locale";

describe("resolveLocale", () => {
  it("prefers profile, then cookie, then Accept-Language, then vi", () => {
    expect(resolveLocale({ profileLocale: "en", cookieLocale: "vi", acceptLanguage: "vi" })).toBe(
      "en",
    );
    expect(resolveLocale({ profileLocale: null, cookieLocale: "en", acceptLanguage: "vi" })).toBe(
      "en",
    );
    expect(resolveLocale({ acceptLanguage: "en-US,en;q=0.9" })).toBe("en");
    expect(resolveLocale({})).toBe("vi");
  });

  it("ignores unsupported values", () => {
    expect(resolveLocale({ profileLocale: "fr", cookieLocale: "xx", acceptLanguage: "de" })).toBe(
      "vi",
    );
  });
});

describe("matchAcceptLanguage", () => {
  it("honours q-values and order", () => {
    expect(matchAcceptLanguage("fr;q=1, en;q=0.5, vi;q=0.8")).toBe("vi");
    expect(matchAcceptLanguage("en-GB, vi")).toBe("en");
    expect(matchAcceptLanguage("vi-VN;q=0.9, en;q=0.9")).toBe("vi");
  });

  it("skips q=0 and garbage", () => {
    expect(matchAcceptLanguage("en;q=0, vi;q=0.1")).toBe("vi");
    expect(matchAcceptLanguage("*")).toBeUndefined();
    expect(matchAcceptLanguage("")).toBeUndefined();
    expect(matchAcceptLanguage(undefined)).toBeUndefined();
  });
});
