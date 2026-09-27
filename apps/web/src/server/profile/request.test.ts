import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const { hasSessionCookie } = await import("./request");

describe("hasSessionCookie", () => {
  it("spots the @supabase/ssr session cookie, chunked or not", () => {
    expect(hasSessionCookie(["NEXT_LOCALE", "sb-127-auth-token"])).toBe(true);
    expect(hasSessionCookie(["sb-abcdefgh-auth-token.0", "sb-abcdefgh-auth-token.1"])).toBe(true);
    expect(hasSessionCookie(["NEXT_LOCALE", "sb-127-auth-token-code-verifier"])).toBe(false);
    expect(hasSessionCookie([])).toBe(false);
  });
});
