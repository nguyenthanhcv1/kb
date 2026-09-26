import {
  baseEnvSchema,
  optionalString,
  optionalUrl,
  parseEnv,
  port,
  requireWhenDeployed,
} from "@kb/shared/env";
import { z } from "zod";

/** Validated environment of kb-collab (docs/PLAN.md §7.6). */
export const collabEnvSchema = baseEnvSchema
  .extend({
    PORT: port(3001),
    LOG_LEVEL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    ),
    /** Postgres URL for the `kb_collab` role (internal network only). */
    DATABASE_URL: optionalString(),
    /** HS256 secret of Supabase Auth (self-host default). */
    SUPABASE_JWT_SECRET: optionalString(),
    /** Alternative to the secret when Supabase signs with asymmetric keys. */
    SUPABASE_JWKS_URL: optionalUrl(),
    COLLAB_INTERNAL_SECRET: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(32, { error: "must be at least 32 characters" }).optional(),
    ),
    /**
     * Comma-separated origins allowed to open a WebSocket, `*` wildcard inside the host
     * (`https://kb-pr-*.thanhgo.com`). Empty = any origin (local development only).
     */
    ALLOWED_ORIGINS: optionalString(),
    REDIS_URL: optionalString(),
  })
  .superRefine(requireWhenDeployed(["DATABASE_URL", "COLLAB_INTERNAL_SECRET", "ALLOWED_ORIGINS"]))
  .superRefine((env, ctx) => {
    if (env.DATABASE_URL && !env.SUPABASE_JWT_SECRET && !env.SUPABASE_JWKS_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["SUPABASE_JWT_SECRET"],
        message: "is required (or SUPABASE_JWKS_URL) when DATABASE_URL is set",
      });
    }
  });

export type CollabEnv = z.infer<typeof collabEnvSchema>;

export function loadCollabEnv(source: Record<string, string | undefined> = process.env): CollabEnv {
  return parseEnv("kb-collab", collabEnvSchema, source);
}
