import { describe, expect, it } from "vitest";

import { loadCollabEnv } from "./env";

const SECRET = "x".repeat(32);

describe("loadCollabEnv", () => {
  it("runs locally without database settings", () => {
    expect(loadCollabEnv({})).toMatchObject({ APP_ENV: "local", PORT: 3001, LOG_LEVEL: "info" });
  });

  it("requires database, internal secret and allowed origins when deployed", () => {
    expect(() => loadCollabEnv({ APP_ENV: "staging" })).toThrow(
      /DATABASE_URL[\s\S]*COLLAB_INTERNAL_SECRET[\s\S]*ALLOWED_ORIGINS/,
    );
  });

  it("needs a JWT secret or JWKS URL once a database is configured", () => {
    expect(() => loadCollabEnv({ DATABASE_URL: "postgres://x" })).toThrow(
      /SUPABASE_JWT_SECRET: is required/,
    );
    expect(() =>
      loadCollabEnv({
        DATABASE_URL: "postgres://x",
        SUPABASE_JWKS_URL: "https://kb-api.example.com/auth/v1/.well-known/jwks.json",
      }),
    ).not.toThrow();
    expect(() =>
      loadCollabEnv({
        APP_ENV: "production",
        DATABASE_URL: "postgres://x",
        SUPABASE_JWT_SECRET: SECRET,
        COLLAB_INTERNAL_SECRET: SECRET,
        ALLOWED_ORIGINS: "https://kb.thanhgo.com",
      }),
    ).not.toThrow();
  });

  it("rejects a short internal secret and a bad port", () => {
    expect(() => loadCollabEnv({ COLLAB_INTERNAL_SECRET: "short", PORT: "70000" })).toThrow(
      /PORT[\s\S]*COLLAB_INTERNAL_SECRET/,
    );
  });
});
