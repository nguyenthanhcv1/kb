import { describe, expect, it } from "vitest";

import { loadCollabEnv } from "./env";

describe("loadCollabEnv", () => {
  it("runs locally without database settings", () => {
    expect(loadCollabEnv({})).toMatchObject({ APP_ENV: "local", PORT: 3001 });
  });

  it("requires database, JWT and internal secret when deployed", () => {
    expect(() => loadCollabEnv({ APP_ENV: "staging", PORT: "3001" })).toThrow(
      /DATABASE_URL[\s\S]*SUPABASE_JWT_SECRET[\s\S]*COLLAB_INTERNAL_SECRET/,
    );
  });

  it("rejects a short internal secret and a bad port", () => {
    expect(() => loadCollabEnv({ COLLAB_INTERNAL_SECRET: "short", PORT: "70000" })).toThrow(
      /PORT[\s\S]*COLLAB_INTERNAL_SECRET/,
    );
  });
});
