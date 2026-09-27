import { webEnv } from "@/lib/env";
import {
  createSmtpMailer,
  smtpConfigFromEnv,
  type MailMessage,
  type SmtpConfig,
  type SmtpEnv,
  type SmtpSecureMode,
} from "@/server/email/mailer";

export {
  defaultSecureMode,
  SMTP_SECURE_MODES,
  toMessageHeaders,
  type MailMessage,
  type SmtpSecureMode,
} from "@/server/email/mailer";

/**
 * Admin-facing mail helpers of kb-web (T1.7a): the "send test email" action. The SMTP transport
 * itself is shared with the invitation emails and lives in `@/server/email/mailer`; this module
 * only reads the validated env and turns transport failures into stable error codes.
 *
 * ```ts
 * await sendMail({ to: "an@example.com", subject: "…", text: "…", html: "<p>…</p>" });
 * ```
 *
 * Errors: {@link MailError} with `MAIL_NOT_CONFIGURED` (no `SMTP_HOST`/`SMTP_FROM`) or
 * `MAIL_SEND_FAILED` (connection, auth or rejection — details go to the server log only).
 */

export type SendMail = (message: MailMessage) => Promise<void>;

export const MAIL_ERROR_CODES = ["MAIL_NOT_CONFIGURED", "MAIL_SEND_FAILED"] as const;
export type MailErrorCode = (typeof MAIL_ERROR_CODES)[number];

export class MailError extends Error {
  constructor(
    readonly code: MailErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = "MailError";
  }
}

export type MailConfig = SmtpConfig & { secure: SmtpSecureMode };

/** `null` when mail is not configured (no host or no sender). */
export function mailConfigFromEnv(env: SmtpEnv): MailConfig | null {
  return smtpConfigFromEnv(env);
}

export function createMailer(config: MailConfig): SendMail {
  const mailer = createSmtpMailer(config);
  return async (message) => {
    try {
      await mailer.send(message);
    } catch (error) {
      console.error("[mail] send failed", error);
      throw new MailError("MAIL_SEND_FAILED", { cause: error });
    }
  };
}

let cachedMailer: SendMail | undefined;

/** Sends through the SMTP server configured in the env (read once per process, like `webEnv`). */
export const sendMail: SendMail = async (message) => {
  const config = mailConfigFromEnv(webEnv());
  if (!config) throw new MailError("MAIL_NOT_CONFIGURED");
  cachedMailer ??= createMailer(config);
  await cachedMailer(message);
};
