import { describe, expect, it } from "vitest";

import { STATIC_SECURITY_HEADERS, contentSecurityPolicy } from "./security-headers";

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split("; ").map((d) => {
      const [name = "", ...values] = d.split(" ");
      return [name, values];
    }),
  );
}

describe("contentSecurityPolicy", () => {
  const base = {
    supabaseUrl: "https://kb-staging-api.thanhgo.com/",
    collabUrl: "wss://kb-staging-collab.thanhgo.com",
  };

  it("allows the app, Supabase (https + wss) and collab to be contacted", () => {
    const csp = directives(contentSecurityPolicy(base));
    expect(csp.get("connect-src")).toEqual([
      "'self'",
      "https://kb-staging-api.thanhgo.com",
      "wss://kb-staging-api.thanhgo.com",
      "wss://kb-staging-collab.thanhgo.com",
    ]);
    expect(csp.get("img-src")).toContain("https://kb-staging-api.thanhgo.com");
  });

  it("loads profile pictures from any HTTPS host (Google account pictures, pasted links)", () => {
    const prod = directives(contentSecurityPolicy(base));
    expect(prod.get("img-src")).toContain("https:");
    expect(prod.get("img-src")).not.toContain("http:");

    const dev = directives(contentSecurityPolicy({ ...base, dev: true }));
    expect(dev.get("img-src")).toContain("http:");
  });

  it("forbids framing, plugins and foreign base URLs", () => {
    const csp = directives(contentSecurityPolicy(base));
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
    expect(csp.get("default-src")).toEqual(["'self'"]);
  });

  it("lets the login form redirect through Supabase Auth to Google", () => {
    const csp = directives(contentSecurityPolicy(base));
    expect(csp.get("form-action")).toEqual([
      "'self'",
      "https://kb-staging-api.thanhgo.com",
      "https://accounts.google.com",
    ]);
  });

  it("only allows eval and plain websockets in development", () => {
    const prod = directives(contentSecurityPolicy(base));
    expect(prod.get("script-src")).not.toContain("'unsafe-eval'");
    expect(prod.get("connect-src")).not.toContain("ws:");

    const dev = directives(contentSecurityPolicy({ ...base, dev: true }));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(dev.get("connect-src")).toContain("ws:");
  });

  it("upgrades insecure requests only when asked (deployed behind HTTPS)", () => {
    expect(directives(contentSecurityPolicy(base)).has("upgrade-insecure-requests")).toBe(false);
    expect(
      directives(contentSecurityPolicy({ ...base, upgradeInsecureRequests: true })).has(
        "upgrade-insecure-requests",
      ),
    ).toBe(true);
  });

  it("ignores a missing or malformed collab URL", () => {
    const csp = directives(
      contentSecurityPolicy({ supabaseUrl: "http://127.0.0.1:54321", collabUrl: "not a url" }),
    );
    expect(csp.get("connect-src")).toEqual([
      "'self'",
      "http://127.0.0.1:54321",
      "ws://127.0.0.1:54321",
    ]);
  });
});

describe("STATIC_SECURITY_HEADERS", () => {
  it("sets the headers securityheaders.com grades", () => {
    const names = STATIC_SECURITY_HEADERS.map((h) => h.key);
    expect(names).toEqual(
      expect.arrayContaining([
        "Strict-Transport-Security",
        "X-Content-Type-Options",
        "X-Frame-Options",
        "Referrer-Policy",
        "Permissions-Policy",
      ]),
    );
  });
});
