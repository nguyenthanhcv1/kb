import { Message, SMTPClient } from "emailjs";

/**
 * Outgoing mail for kb-web (docs/PLAN.md §7.14). Supabase self-host has no mail service, so the
 * app talks SMTP itself; only the `SMTP_*` env vars pick the provider (Gmail App Password now,
 * Resend later). `emailjs` (MIT, no dependencies) is used instead of nodemailer because
 * nodemailer is MIT-0, which is not on the license allowlist (scripts/licenses/policy.json).
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

export interface Mailer {
  /** Resolves once the SMTP server accepted the message; rejects on any SMTP/transport error. */
  send(message: MailMessage): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  password?: string;
  /** `"KB <kb@example.com>"` or a bare address. */
  from: string;
  replyTo?: string;
}

/**
 * SMTP mailer. Transport security follows the port convention: 465 = implicit TLS, 587 =
 * STARTTLS (required — emailjs always issues it, e.g. Gmail), any other port = plain SMTP (local
 * Mailpit on 54325). Authenticates only when a user is set.
 */
export function createSmtpMailer(config: SmtpConfig): Mailer {
  const client = new SMTPClient({
    host: config.host,
    port: config.port,
    ssl: config.port === 465,
    tls: config.port === 587,
    timeout: 15_000,
    ...(config.user ? { user: config.user, password: config.password ?? "" } : {}),
  });

  return {
    async send(message) {
      await client.sendAsync(
        new Message({
          from: config.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.replyTo || config.replyTo
            ? { "reply-to": message.replyTo ?? config.replyTo }
            : {}),
          attachment: [{ data: message.html, alternative: true }],
        }),
      );
    },
  };
}

/** Env subset read here (a `WebEnv` satisfies it). */
export interface SmtpEnv {
  SMTP_HOST?: string;
  SMTP_PORT: number;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM?: string;
  SMTP_REPLY_TO?: string;
}

/**
 * Mailer from `SMTP_*`, or `null` when `SMTP_HOST`/`SMTP_FROM` are unset (local dev without
 * Mailpit, CI): callers then skip sending and report it (`emailStatus: "skipped"`).
 */
export function mailerFromEnv(env: SmtpEnv): Mailer | null {
  if (!env.SMTP_HOST || !env.SMTP_FROM) return null;
  return createSmtpMailer({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.SMTP_FROM,
    replyTo: env.SMTP_REPLY_TO,
  });
}
