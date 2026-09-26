import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  baseEnvSchema,
  EnvValidationError,
  parseEnv,
  requiredString,
  requiredUrl,
  requireWhenDeployed,
} from "./env";

const schema = baseEnvSchema
  .extend({ SUPABASE_URL: requiredString(), DATABASE_URL: z.string().optional() })
  .superRefine(requireWhenDeployed(["DATABASE_URL"]));

describe("parseEnv", () => {
  it("applies defaults for the base variables", () => {
    expect(parseEnv("test", schema, { SUPABASE_URL: "x" })).toMatchObject({
      APP_ENV: "local",
      APP_VERSION: "0.0.0-dev",
      GIT_SHA: "unknown",
    });
  });

  it("names every missing or invalid variable", () => {
    let error: unknown;
    try {
      parseEnv("kb-test", schema, { APP_ENV: "prod", SUPABASE_URL: "" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EnvValidationError);
    expect((error as EnvValidationError).variables).toEqual(["APP_ENV", "SUPABASE_URL"]);
    expect((error as Error).message).toMatch(
      /^\[kb-test\] Invalid environment variables:\n {2}- APP_ENV: /,
    );
  });

  it("tells a missing URL from a malformed one", () => {
    const urls = baseEnvSchema.extend({ A: requiredUrl(), B: requiredUrl() });
    expect(() => parseEnv("t", urls, { B: "not a url" })).toThrow(
      /A: is required\n {2}- B: must be a URL/,
    );
  });

  it("requires deployment-only variables outside local", () => {
    expect(() => parseEnv("t", schema, { SUPABASE_URL: "x", APP_ENV: "local" })).not.toThrow();
    expect(() => parseEnv("t", schema, { SUPABASE_URL: "x", APP_ENV: "staging" })).toThrow(
      /DATABASE_URL: is required when APP_ENV=staging/,
    );
    expect(() =>
      parseEnv("t", schema, {
        SUPABASE_URL: "x",
        APP_ENV: "production",
        DATABASE_URL: "postgres://x",
      }),
    ).not.toThrow();
  });
});
