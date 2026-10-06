import {
  type AppEnv,
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

import webPackage from "../../package.json";

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
      /**
       * HS256 JWT secret of Supabase (the one kb-collab may also use). Lets the MCP connector run
       * each AI tool call as the user under RLS; unset = the connector answers 503.
       */
      SUPABASE_JWT_SECRET: z.preprocess(
        (value) => (value === "" ? undefined : value),
        z.string().min(32, { error: "must be at least 32 characters" }).optional(),
      ),
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
      // Unset → derived from SMTP_PORT (465 ssl, 587 starttls, else none) — server/email/mailer.ts.
      SMTP_SECURE: z.preprocess(
        (value) => (value === "" ? undefined : value),
        z.enum(["ssl", "starttls", "none"]).optional(),
      ),
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

/**
 * Version of the release this build belongs to: `apps/web/package.json`, bumped by release-please
 * (`extra-files` in release-please-config.json). Imported (not read from disk) so it is bundled
 * into the standalone server and cannot go missing in the Docker image.
 */
export const PACKAGE_VERSION: string = webPackage.version;

export type AppInfo = {
  /** `APP_VERSION` from the image build (`0.3.0`, `0.3.0-abc1234` on main), else {@link PACKAGE_VERSION}. */
  version: string;
  sha: string;
  env: AppEnv;
};

/** Build/release identity for `/api/health` and the footer. Never throws. */
export function appInfo(env: Record<string, string | undefined> = process.env): AppInfo {
  const base = baseEnvSchema.safeParse(env);
  const info = base.success ? base.data : baseEnvSchema.parse({});
  const version = env.APP_VERSION?.trim() || PACKAGE_VERSION;
  return { version, sha: info.GIT_SHA, env: info.APP_ENV };
}
