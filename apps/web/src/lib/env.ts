import {
  baseEnvSchema,
  optionalString,
  optionalUrl,
  parseEnv,
  port,
  requiredString,
  requiredUrl,
  requireWhenDeployed,
} from "@kb/shared/env";
import { z } from "zod";

/**
 * Validated server environment of kb-web (docs/PLAN.md §7.6). Parsed once at startup from
 * `src/instrumentation.ts`; a missing variable stops the server with its name.
 *
 * No `NEXT_PUBLIC_*`: those are frozen at build time and would pin an image to one
 * environment. Public settings are read here at runtime and handed to the client by the server.
 */
export const webEnvSchema = z
  .preprocess(
    (raw) => {
      const env = { ...(raw as Record<string, string | undefined>) };
      // Accept the names lib/supabase/env.ts reads today until it moves to `webEnv()`.
      env.SUPABASE_URL ||= env.NEXT_PUBLIC_SUPABASE_URL;
      env.SUPABASE_ANON_KEY ||= env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      return env;
    },
    baseEnvSchema.extend({
      PORT: port(3000),
      APP_URL: optionalUrl(),
      SUPABASE_URL: requiredUrl(),
      SUPABASE_ANON_KEY: requiredString(),
      SUPABASE_SERVICE_ROLE_KEY: requiredString(),
      COLLAB_PUBLIC_URL: optionalUrl(),
      COLLAB_INTERNAL_URL: optionalUrl(),
      COLLAB_INTERNAL_SECRET: z.preprocess(
        (value) => (value === "" ? undefined : value),
        z.string().min(32, { error: "must be at least 32 characters" }).optional(),
      ),
      DEFAULT_LOCALE: z.preprocess(
        (value) => (value === "" ? undefined : value),
        z.enum(["vi", "en"]).default("vi"),
      ),
      DEFAULT_TIME_ZONE: z.preprocess(
        (value) => (value === "" ? undefined : value),
        z.string().default("Asia/Ho_Chi_Minh"),
      ),
      SMTP_HOST: optionalString(),
      SMTP_PORT: port(587),
      SMTP_USER: optionalString(),
      SMTP_PASSWORD: optionalString(),
      SMTP_FROM: optionalString(),
      SMTP_REPLY_TO: optionalString(),
      BOOTSTRAP_SUPER_ADMIN_EMAILS: optionalString(),
    }),
  )
  .superRefine(requireWhenDeployed(["APP_URL"]));

export type WebEnv = z.infer<typeof webEnvSchema>;

let cached: WebEnv | undefined;

/** Server-only. Throws `EnvValidationError` listing every invalid variable. */
export function webEnv(): WebEnv {
  cached ??= parseEnv("kb-web", webEnvSchema);
  return cached;
}

/** Build/release identity for `/api/health` and the footer. Never throws. */
export function appInfo() {
  const base = baseEnvSchema.safeParse(process.env);
  const info = base.success ? base.data : baseEnvSchema.parse({});
  return { version: info.APP_VERSION, sha: info.GIT_SHA, env: info.APP_ENV };
}
