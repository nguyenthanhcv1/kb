import { baseEnvSchema, optionalString, parseEnv, port, requireWhenDeployed } from "@kb/shared/env";
import { z } from "zod";

/**
 * Validated environment of kb-collab (docs/PLAN.md §7.6). Database and JWT settings are only
 * enforced once the server actually uses them in deployed environments (T3.4 wires them up).
 */
export const collabEnvSchema = baseEnvSchema
  .extend({
    PORT: port(3001),
    /** Postgres URL for the `kb_collab` role (internal network only). */
    DATABASE_URL: optionalString(),
    SUPABASE_JWT_SECRET: optionalString(),
    COLLAB_INTERNAL_SECRET: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(32, { error: "must be at least 32 characters" }).optional(),
    ),
    REDIS_URL: optionalString(),
  })
  .superRefine(
    requireWhenDeployed(["DATABASE_URL", "SUPABASE_JWT_SECRET", "COLLAB_INTERNAL_SECRET"]),
  );

export type CollabEnv = z.infer<typeof collabEnvSchema>;

export function loadCollabEnv(source: Record<string, string | undefined> = process.env): CollabEnv {
  return parseEnv("kb-collab", collabEnvSchema, source);
}
