import { defaultTimeZone, formats, loadMessages, type Locale } from "@kb/i18n";
import { createTranslator } from "next-intl";

import type { MailMessage } from "./index";

/**
 * Bilingual mail bodies, rendered in the recipient's locale (not the request's): messages come
 * from `@kb/i18n` directly rather than the next-intl request config.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain text → minimal HTML: one `<p>` per blank-line-separated paragraph. */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

export interface TestEmailContext {
  locale: Locale;
  /** Email of the super admin who pressed "send test email". */
  sender: string;
  sentAt?: Date;
  timeZone?: string;
}

/** "Send test email" (/admin, T1.7): `email.test.subject` / `email.test.body`. */
export async function buildTestEmail(context: TestEmailContext): Promise<Omit<MailMessage, "to">> {
  const messages = await loadMessages(context.locale, ["common", "email"]);
  const t = createTranslator({
    locale: context.locale,
    messages,
    formats,
    timeZone: context.timeZone ?? defaultTimeZone,
  });
  const app = t("common.app.name");
  const subject = t("email.test.subject", { app });
  const text = t("email.test.body", {
    app,
    sender: context.sender,
    sentAt: context.sentAt ?? new Date(),
  });
  return { subject, text, html: textToHtml(text) };
}

export interface AccountDecisionEmailContext {
  locale: Locale;
  decision: "approved" | "rejected";
  /** Why the account was rejected (optional, rejected only). */
  reason?: string;
  /** Public origin of kb-web: the approval email links to it. */
  appUrl: string;
}

/**
 * Sent to the person when a super admin reviews their account:
 * `email.accountApproved.*` / `email.accountRejected.*`, in their own locale.
 */
export async function buildAccountDecisionEmail(
  context: AccountDecisionEmailContext,
): Promise<Omit<MailMessage, "to">> {
  const messages = await loadMessages(context.locale, ["common", "email"]);
  const t = createTranslator({
    locale: context.locale,
    messages,
    formats,
    timeZone: defaultTimeZone,
  });
  const app = t("common.app.name");
  if (context.decision === "approved") {
    const text = t("email.accountApproved.body", { app, url: context.appUrl });
    return { subject: t("email.accountApproved.subject", { app }), text, html: textToHtml(text) };
  }
  const text = context.reason
    ? t("email.accountRejected.bodyWithReason", { app, reason: context.reason })
    : t("email.accountRejected.body", { app });
  return { subject: t("email.accountRejected.subject", { app }), text, html: textToHtml(text) };
}
