import { Message, SMTPClient, type MessageHeaders } from "emailjs";

/**
 * Outgoing mail for kb-web (docs/PLAN.md §7.14) — the one SMTP transport of the app, used by the
 * invitation emails (`server/members`, T1.5a) and the admin test email (`server/mail`, T1.7a).
 * Supabase self-host has no mail service, so the app talks SMTP itself; only the `SMTP_*` env vars
 * pick the provider (Gmail App Password now, Resend later). `emailjs` (MIT, no dependencies) is
 * used instead of nodemailer because nodemailer is MIT-0, which is not on the license allowlist
 * (scripts/licenses/policy.json).
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML alternative of `text`. */
  html?: string;
  replyTo?: string;
}

export interface Mailer {
  /** Resolves once the SMTP server accepted the message; rejects on any SMTP/transport error. */
  send(message: MailMessage): Promise<void>;
}

/** How the connection is secured: implicit TLS (465), STARTTLS (587) or plain (local Mailpit). */
export const SMTP_SECURE_MODES = ["ssl", "starttls", "none"] as const;
export type SmtpSecureMode = (typeof SMTP_SECURE_MODES)[number];

/** Default when `SMTP_SECURE` is unset: 465 → `ssl`, 587 → `starttls`, anything else → `none`. */
export function defaultSecureMode(port: number): SmtpSecureMode {
  if (port === 465) return "ssl";
  if (port === 587) return "starttls";
  return "none";
}

export interface SmtpConfig {
  host: string;
  port: number;
  /** Omit to derive it from the port ({@link defaultSecureMode}). */
  secure?: SmtpSecureMode;
  user?: string;
  password?: string;
  /** `"KB <kb@example.com>"` or a bare address. */
  from: string;
  replyTo?: string;
}

const SMTP_TIMEOUT_MS = 15_000;

/** Headers emailjs sends for `message` under `config` (exported for tests). */
export function toMessageHeaders(config: SmtpConfig, message: MailMessage): MessageHeaders {
  const replyTo = message.replyTo ?? config.replyTo;
  return {
    from: config.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    ...(replyTo ? { "reply-to": replyTo } : {}),
    ...(message.html ? { attachment: [{ data: message.html, alternative: true }] } : {}),
  };
}

/** SMTP mailer. Authenticates only when a user is set. */
export function createSmtpMailer(config: SmtpConfig): Mailer {
  const secure = config.secure ?? defaultSecureMode(config.port);
  const client = new SMTPClient({
    host: config.host,
    port: config.port,
    ssl: secure === "ssl",
    tls: secure === "starttls",
    timeout: SMTP_TIMEOUT_MS,
    ...(config.user ? { user: config.user, password: config.password ?? "" } : {}),
  });

  return {
    async send(message) {
      await client.sendAsync(new Message(toMessageHeaders(config, message)));
    },
  };
}

/** Env subset read here (a `WebEnv` satisfies it). */
export interface SmtpEnv {
  SMTP_HOST?: string;
  SMTP_PORT: number;
  SMTP_SECURE?: SmtpSecureMode;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM?: string;
  SMTP_REPLY_TO?: string;
}

/** SMTP settings from `SMTP_*`, or `null` when `SMTP_HOST`/`SMTP_FROM` are unset. */
export function smtpConfigFromEnv(env: SmtpEnv): (SmtpConfig & { secure: SmtpSecureMode }) | null {
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

/**
 * Mailer from `SMTP_*`, or `null` when `SMTP_HOST`/`SMTP_FROM` are unset (local dev without
 * Mailpit, CI): callers then skip sending and report it (`emailStatus: "skipped"`).
 */
export function mailerFromEnv(env: SmtpEnv): Mailer | null {
  const config = smtpConfigFromEnv(env);
  return config ? createSmtpMailer(config) : null;
}
