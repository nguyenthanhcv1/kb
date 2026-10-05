import { describe, expect, it } from "vitest";

import { publicOrigin } from "./public-origin";

describe("publicOrigin", () => {
  it("uses APP_URL instead of the bind address behind a proxy", () => {
    expect(publicOrigin("http://0.0.0.0:3000/auth/callback?code=x", "https://kb.thanhgo.com")).toBe(
      "https://kb.thanhgo.com",
    );
  });

  it("drops any path of APP_URL", () => {
    expect(publicOrigin("http://0.0.0.0:3000/", "https://kb.thanhgo.com/some/path")).toBe(
      "https://kb.thanhgo.com",
    );
  });

  it("falls back to the request origin without APP_URL (local dev)", () => {
    expect(publicOrigin("http://localhost:3000/login?next=/", "")).toBe("http://localhost:3000");
    expect(publicOrigin("http://localhost:3000/login", undefined)).toBe("http://localhost:3000");
  });
});
