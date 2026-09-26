import { pino, type Logger } from "pino";

import type { CollabEnv } from "./env";

/** JSON logs on stdout (collected by Coolify/Docker). */
export function createLogger(
  env: Pick<CollabEnv, "LOG_LEVEL" | "APP_VERSION" | "APP_ENV">,
): Logger {
  return pino({
    level: env.LOG_LEVEL,
    base: { service: "kb-collab", version: env.APP_VERSION, env: env.APP_ENV },
    redact: ["token", "*.token", "headers.authorization", "headers.cookie"],
  });
}

export type { Logger };
