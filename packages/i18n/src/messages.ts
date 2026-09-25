import type { GeneratedMessages } from "./messages.gen";

/**
 * Shape of all messages, inferred from `messages/vi/*.json` (Vietnamese is the source of truth).
 * Use it for next-intl type-safety: `declare module "next-intl" { interface AppConfig { Messages: Messages } }`.
 *
 * `messages.gen.ts` is generated (gitignored) by `pnpm --filter @kb/i18n build`, which turbo
 * runs before any dependent package's lint/typecheck/test/build.
 */
export type Messages = GeneratedMessages;
