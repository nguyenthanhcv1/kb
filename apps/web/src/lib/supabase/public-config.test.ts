// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { publicSupabaseConfigScript, readPublicSupabaseConfig } from "./public-config";

describe("public Supabase config", () => {
  afterEach(() => {
    delete window.__KB_SUPABASE__;
    vi.unstubAllEnvs();
  });

  it("prefers the values injected by the layout over build-time ones", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://build.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "build-key");
    window.__KB_SUPABASE__ = { url: "https://runtime.example", anonKey: "runtime-key" };
    expect(readPublicSupabaseConfig()).toEqual({
      url: "https://runtime.example",
      anonKey: "runtime-key",
    });
  });

  it("falls back to build-time values, and null when nothing is set", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://build.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "build-key");
    expect(readPublicSupabaseConfig()).toEqual({
      url: "https://build.example",
      anonKey: "build-key",
    });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(readPublicSupabaseConfig()).toBeNull();
  });

  it("builds a script that sets the config and cannot close its tag", () => {
    const script = publicSupabaseConfigScript({
      url: "https://api.example",
      anonKey: "</script><script>alert(1)</script>",
    });
    expect(script).not.toContain("</script>");
    new Function(script)();
    expect(window.__KB_SUPABASE__).toEqual({
      url: "https://api.example",
      anonKey: "</script><script>alert(1)</script>",
    });
  });
});
