import { afterEach, describe, expect, it, vi } from "vitest";

import webPackage from "../../../../package.json";
import { PACKAGE_VERSION, appInfo } from "@/lib/env";

import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/health", () => {
  it("returns status, version, sha and env without caching", async () => {
    vi.stubEnv("APP_VERSION", "0.3.0");
    vi.stubEnv("GIT_SHA", "abc1234");
    vi.stubEnv("APP_ENV", "staging");
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      status: "ok",
      version: "0.3.0",
      sha: "abc1234",
      env: "staging",
    });
  });

  it("falls back to the package version released by release-please when APP_VERSION is unset", async () => {
    vi.stubEnv("APP_VERSION", "");
    const body = (await GET().json()) as { version: string };
    expect(body.version).toBe(webPackage.version);
    expect(PACKAGE_VERSION).toBe(webPackage.version);
  });
});

describe("appInfo", () => {
  it("never throws on invalid env", () => {
    expect(appInfo({ APP_ENV: "nope", APP_VERSION: " 1.2.3 " })).toEqual({
      version: "1.2.3",
      sha: "unknown",
      env: "local",
    });
  });
});
