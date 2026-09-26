import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { createAccessTokenVerifier, createOriginCheck, parseDocumentName } from "./auth";

const SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const USER = "00000000-0000-4000-8000-000000000001";

function sign(claims: Record<string, unknown>, { secret = SECRET, expiresIn = "1h" } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
}

describe("parseDocumentName", () => {
  it.each([
    ["page:20000000-0000-0000-0000-00000000000A", "20000000-0000-0000-0000-00000000000a"],
    ["page:not-a-uuid", null],
    ["20000000-0000-0000-0000-000000000001", null],
    ["space:20000000-0000-0000-0000-000000000001", null],
  ])("%s → %s", (name, expected) => {
    expect(parseDocumentName(name)).toBe(expected);
  });
});

describe("createAccessTokenVerifier", () => {
  const verify = createAccessTokenVerifier({ SUPABASE_JWT_SECRET: SECRET });

  it("accepts an authenticated Supabase token", async () => {
    await expect(verify(await sign({ sub: USER, role: "authenticated" }))).resolves.toEqual({
      userId: USER,
    });
  });

  it.each([
    [
      "wrong signature",
      () => sign({ sub: USER, role: "authenticated" }, { secret: "y".repeat(40) }),
    ],
    ["expired", () => sign({ sub: USER, role: "authenticated" }, { expiresIn: "-1m" })],
    ["anon role", () => sign({ sub: USER, role: "anon" })],
    ["service role", () => sign({ role: "service_role" })],
    ["missing sub", () => sign({ role: "authenticated" })],
    ["garbage", async () => "not.a.jwt"],
    ["empty", async () => ""],
  ])("rejects %s with UNAUTHORIZED", async (_label, make) => {
    await expect(verify(await make())).rejects.toMatchObject({ reason: "UNAUTHORIZED" });
  });
});

describe("createOriginCheck", () => {
  it("allows everything when unset", () => {
    expect(createOriginCheck(undefined)(null)).toBe(true);
  });

  it("matches exact origins and host wildcards", () => {
    const check = createOriginCheck("https://kb.thanhgo.com, https://kb-pr-*.thanhgo.com/");
    expect(check("https://kb.thanhgo.com")).toBe(true);
    expect(check("https://kb-pr-42.thanhgo.com")).toBe(true);
    expect(check("https://kb-pr-42.thanhgo.com.evil.com")).toBe(false);
    expect(check("https://evil.com")).toBe(false);
    expect(check("http://kb.thanhgo.com")).toBe(false);
    expect(check(null)).toBe(false);
  });
});
