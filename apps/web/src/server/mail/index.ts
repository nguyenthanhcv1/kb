import { SMTPClient, type MessageHeaders } from "emailjs";

import { webEnv, type WebEnv } from "@/lib/env";

/**
 * Minimal SMTP mailer of kb-web (docs/PLAN.md §7.14). Server-only. Reads `SMTP_*` from the
 * validated env, so switching provider (Gmail App Password → Resend → …) is only an env change.
 * Library: `emailjs` (MIT, no dependencies) — `nodemailer` is MIT-0, outside the license allowlist
 * (scripts/licenses/policy.json).
 *
 * ```ts
 * await sendMail({ to: "an@example.com", subject: "…", text: "…", html: "<p>…</p>" });
 * ```
 *
 * Errors: {@link MailError} with `MAIL_NOT_CONFIGURED` (no `SMTP_HOST`/`SMTP_FROM`) or
 * `MAIL_SEND_FAILED` (connection, auth or rejection — details go to the server log only).
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML alternative of `text`. */
  html?: string;
}

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

/** How the connection is secured: implicit TLS (465), STARTTLS (587) or plain (local Mailpit). */
export const SMTP_SECURE_MODES = ["ssl", "starttls", "none"] as const;
export type SmtpSecureMode = (typeof SMTP_SECURE_MODES)[number];

export interface MailConfig {
  host: string;
  port: number;
  secure: SmtpSecureMode;
  user?: string;
  password?: string;
  from: string;
  replyTo?: string;
}

type SmtpEnv = Pick<
  WebEnv,
  | "SMTP_HOST"
  | "SMTP_PORT"
  | "SMTP_SECURE"
  | "SMTP_USER"
  | "SMTP_PASSWORD"
  | "SMTP_FROM"
  | "SMTP_REPLY_TO"
>;

/** `SMTP_SECURE` when set, else by port: 465 → `ssl`, 587 → `starttls`, anything else → `none`. */
export function defaultSecureMode(port: number): SmtpSecureMode {
  if (port === 465) return "ssl";
  if (port === 587) return "starttls";
  return "none";
}

/** `null` when mail is not configured (no host or no sender). */
export function mailConfigFromEnv(env: SmtpEnv): MailConfig | null {
  if (!env.SMTP_HOST || !env.SMTP_FROM) return null;
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE ?? defaultSecureMode(env.SMTP_PORT),
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.SMTP_FROM,
    replyTo: env.SMTP_REPLY_TO,
  };
}

const SMTP_TIMEOUT_MS = 15_000;

/** Headers emailjs sends for `message` under `config` (exported for tests). */
export function toMessageHeaders(config: MailConfig, message: MailMessage): MessageHeaders {
  return {
    from: config.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    ...(config.replyTo ? { "reply-to": config.replyTo } : {}),
    ...(message.html ? { attachment: [{ data: message.html, alternative: true }] } : {}),
  };
}

export function createMailer(config: MailConfig): SendMail {
  const client = new SMTPClient({
    host: config.host,
    port: config.port,
    ssl: config.secure === "ssl",
    tls: config.secure === "starttls",
    timeout: SMTP_TIMEOUT_MS,
    ...(config.user && config.password ? { user: config.user, password: config.password } : {}),
  });
  return async (message) => {
    try {
      await client.sendAsync(toMessageHeaders(config, message));
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
