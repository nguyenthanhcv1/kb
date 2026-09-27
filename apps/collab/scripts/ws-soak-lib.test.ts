import { describe, expect, it } from "vitest";

import { extractAccessToken, parseSoakArgs, summarize, tokenExpiresAt } from "./ws-soak-lib";

const PAGE = "3f2b6c1e-8a4d-4b7e-9c1a-2d5e6f708192";
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const JWT = `${b64({ alg: "HS256" })}.${b64({ sub: "x", exp: 1_900_000_000 })}.sig`;

describe("parseSoakArgs", () => {
  it("reads flags, the token from env and applies defaults", () => {
    const options = parseSoakArgs(["--", "--url", "wss://collab.example/", "--page", PAGE], {
      KB_SOAK_TOKEN: JWT,
    });
    expect(options).toEqual({
      url: "wss://collab.example",
      pageId: PAGE,
      token: JWT,
      origin: undefined,
      minutes: 35,
      maxDisconnects: 0,
      awareness: true,
      heartbeatSeconds: 60,
    });
  });

  it("supports --no-awareness, --origin and numeric options", () => {
    const options = parseSoakArgs(
      [
        "--url=ws://127.0.0.1:3001",
        `--page=${PAGE.toUpperCase()}`,
        `--token=${JWT}`,
        "--origin=https://kb-staging.example",
        "--minutes=0.5",
        "--max-disconnects=2",
        "--heartbeat=5",
        "--no-awareness",
      ],
      {},
    );
    expect(options).toMatchObject({
      pageId: PAGE,
      origin: "https://kb-staging.example",
      minutes: 0.5,
      maxDisconnects: 2,
      awareness: false,
      heartbeatSeconds: 5,
    });
  });

  it.each([
    [["--page", PAGE], "--url"],
    [["--url", "https://collab.example", "--page", PAGE], "--url"],
    [["--url", "wss://collab.example/x", "--page", PAGE], "--url"],
    [["--url", "wss://collab.example", "--page", "nope"], "--page"],
    [["--url", "wss://collab.example", "--page", PAGE, "--minutes", "0"], "--minutes"],
    [["--url", "wss://collab.example", "--page", PAGE, "--max-disconnects", "-1"], "--max"],
  ])("rejects %j", (argv, message) => {
    expect(() => parseSoakArgs(argv, { KB_SOAK_TOKEN: JWT })).toThrow(message);
  });

  it("requires a token", () => {
    expect(() => parseSoakArgs(["--url", "wss://c.example", "--page", PAGE], {})).toThrow(
      "KB_SOAK_TOKEN",
    );
  });
});

describe("extractAccessToken", () => {
  it("accepts a raw JWT", () => {
    expect(extractAccessToken(` ${JWT}\n`)).toBe(JWT);
  });

  it("accepts the @supabase/ssr cookie (base64- prefix and URL-encoded JSON)", () => {
    const session = { access_token: JWT, refresh_token: "r" };
    expect(extractAccessToken(`base64-${b64(session)}`)).toBe(JWT);
    expect(extractAccessToken(encodeURIComponent(JSON.stringify(session)))).toBe(JWT);
  });

  it("rejects anything else", () => {
    expect(() => extractAccessToken("not-a-token")).toThrow("neither a JWT");
    expect(() => extractAccessToken(`base64-${b64({ nope: 1 })}`)).toThrow("neither a JWT");
  });
});

describe("tokenExpiresAt", () => {
  it("returns exp in ms, or null when unreadable", () => {
    expect(tokenExpiresAt(JWT)).toBe(1_900_000_000_000);
    expect(tokenExpiresAt("a.b.c")).toBeNull();
  });
});

describe("summarize", () => {
  const start = 1_000;
  const minute = 60_000;

  it("passes one uninterrupted, authenticated connection", () => {
    const summary = summarize(
      [
        { type: "connect", at: start + 100 },
        { type: "authenticated", at: start + 200 },
      ],
      start,
      start + 35 * minute,
      0,
    );
    expect(summary).toMatchObject({
      connects: 1,
      disconnects: 0,
      connectedAtEnd: true,
      longestConnectedMs: 35 * minute - 100,
      passed: true,
    });
  });

  it("fails on a drop even if it reconnected, unless tolerated", () => {
    const events = [
      { type: "connect", at: start },
      { type: "authenticated", at: start },
      { type: "disconnect", at: start + 10 * minute, code: 1006 },
      { type: "connect", at: start + 10 * minute + 2_000 },
      { type: "authenticated", at: start + 10 * minute + 2_100 },
    ] as const;
    const strict = summarize([...events], start, start + 35 * minute, 0);
    expect(strict).toMatchObject({
      disconnects: 1,
      connects: 2,
      longestConnectedMs: 25 * minute - 2_000,
      passed: false,
    });
    expect(strict.disconnectLog).toEqual([{ atMs: 10 * minute, code: 1006, reason: undefined }]);
    expect(summarize([...events], start, start + 35 * minute, 1).passed).toBe(true);
  });

  it("fails when down at the end or never authenticated", () => {
    expect(
      summarize(
        [
          { type: "connect", at: start },
          { type: "authenticated", at: start },
          { type: "disconnect", at: start + minute },
        ],
        start,
        start + 2 * minute,
        5,
      ),
    ).toMatchObject({ connectedAtEnd: false, passed: false });
    expect(
      summarize(
        [
          { type: "connect", at: start },
          { type: "authenticationFailed", at: start, reason: "UNAUTHORIZED" },
        ],
        start,
        start + minute,
        0,
      ),
    ).toMatchObject({ authenticationFailed: "UNAUTHORIZED", passed: false });
  });
});
