import { z } from "zod";

/**
 * Runtime environment validation shared by kb-web and kb-collab (docs/PLAN.md §7.6).
 *
 * Every app parses `process.env` once at startup; a missing or malformed variable stops the
 * process with the variable names, so a bad deploy fails its health check instead of serving
 * errors later. Values are read at runtime (never baked in at build time), so the same image
 * runs on preview, staging and production.
 */

export const APP_ENVS = ["local", "test", "preview", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/** Environments that serve real users: optional-in-dev settings become required there. */
export const DEPLOYED_APP_ENVS: readonly AppEnv[] = ["preview", "staging", "production"];

/** Empty strings (common in `.env` files and Coolify) count as "not set". */
const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

export const optionalString = () => z.preprocess(emptyToUndefined, z.string().optional());
export const requiredString = () =>
  z.preprocess(emptyToUndefined, z.string({ error: "is required" }).min(1));
export const optionalUrl = () => z.preprocess(emptyToUndefined, z.url().optional());
export const requiredUrl = () =>
  z.preprocess(
    emptyToUndefined,
    z.url({ error: (issue) => (issue.input === undefined ? "is required" : "must be a URL") }),
  );
export const port = (fallback: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65_535).default(fallback));

/** Variables every service understands. */
export const baseEnvSchema = z.object({
  APP_ENV: z.preprocess(emptyToUndefined, z.enum(APP_ENVS).default("local")),
  /** Release version, injected by the image build (`--build-arg APP_VERSION`). */
  APP_VERSION: z.preprocess(emptyToUndefined, z.string().default("0.0.0-dev")),
  /** Commit the image was built from (`--build-arg GIT_SHA`). */
  GIT_SHA: z.preprocess(emptyToUndefined, z.string().default("unknown")),
  SENTRY_DSN: optionalUrl(),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

export class EnvValidationError extends Error {
  readonly variables: string[];

  constructor(service: string, issues: z.core.$ZodIssue[]) {
    const lines = issues.map(
      (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    super(`[${service}] Invalid environment variables:\n${lines.join("\n")}`);
    this.name = "EnvValidationError";
    this.variables = [...new Set(issues.map((issue) => issue.path.join(".")))];
  }
}

/** Parse `source` (default `process.env`) or throw an `EnvValidationError` naming every bad variable. */
export function parseEnv<S extends z.ZodType>(
  service: string,
  schema: S,
  source: Record<string, string | undefined> = process.env,
): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) throw new EnvValidationError(service, result.error.issues);
  return result.data;
}

/**
 * Adds "required when deployed" checks: `keys` may be empty locally but must be set when
 * `APP_ENV` is preview/staging/production.
 */
export function requireWhenDeployed<T extends { APP_ENV: AppEnv }>(
  keys: readonly (keyof T & string)[],
) {
  return (env: T, ctx: z.RefinementCtx) => {
    if (!DEPLOYED_APP_ENVS.includes(env.APP_ENV)) return;
    for (const key of keys) {
      if (env[key] === undefined) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `is required when APP_ENV=${env.APP_ENV}`,
        });
      }
    }
  };
}

/** Print the error and exit: used at process start so the container restarts visibly unhealthy. */
export function exitOnInvalidEnv(error: unknown): never {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
