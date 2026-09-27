import { defaultTimeZone, loadMessages, type Locale } from "@kb/i18n";
import { createFormatter, createTranslator } from "next-intl";

import type { MailMessage } from "./mailer";

/**
 * Plain bilingual invitation email (T1.5a). Every visible string comes from
 * `email.invitation.*` / `space.roles.*`; T1.5b replaces this with a React Email template using the
 * same keys. With several locales (invitee has no account yet → `["vi", "en"]`, docs/PLAN.md
 * §5 "Email"), each section is repeated per locale, Vietnamese first.
 */
export interface InvitationEmailInput {
  to: string;
  locales: readonly Locale[];
  inviterName: string;
  spaceName: string;
  role: "viewer" | "editor";
  acceptUrl: string;
  expiresAt: string;
  timeZone?: string;
}

const SUBJECT_SEPARATOR = " / ";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface Section {
  subject: string;
  greeting: string;
  body: string;
  signInHint: string;
  accept: string;
  linkFallback: string;
  expires: string;
  ignore: string;
}

async function renderSection(locale: Locale, input: InvitationEmailInput): Promise<Section> {
  const messages = await loadMessages(locale, ["email", "space"]);
  const timeZone = input.timeZone ?? defaultTimeZone;
  const t = createTranslator({ locale, messages, namespace: "email.invitation" });
  const tRoles = createTranslator({ locale, messages, namespace: "space.roles" });
  const format = createFormatter({ locale, timeZone });
  const date = format.dateTime(new Date(input.expiresAt), {
    dateStyle: "long",
    timeStyle: "short",
    timeZone,
  });
  const params = { inviter: input.inviterName, space: input.spaceName };
  return {
    subject: t("subject", params),
    greeting: t("greeting"),
    body: t("body", { ...params, role: tRoles(input.role) }),
    signInHint: t("signInHint", { email: input.to }),
    accept: t("accept"),
    linkFallback: t("linkFallback"),
    expires: t("expires", { date }),
    ignore: t("ignore"),
  };
}

function sectionText(section: Section, url: string): string {
  return [
    section.greeting,
    "",
    section.body,
    section.signInHint,
    "",
    `${section.accept}: ${url}`,
    "",
    section.expires,
    section.ignore,
  ].join("\n");
}

function sectionHtml(section: Section, url: string, lang: Locale): string {
  const href = escapeHtml(url);
  return [
    `<div lang="${lang}">`,
    `<p>${escapeHtml(section.greeting)}</p>`,
    `<p>${escapeHtml(section.body)}<br>${escapeHtml(section.signInHint)}</p>`,
    `<p><a href="${href}" style="display:inline-block;padding:10px 16px;border-radius:6px;background:#111827;color:#ffffff;text-decoration:none">${escapeHtml(section.accept)}</a></p>`,
    `<p>${escapeHtml(section.linkFallback)}<br><a href="${href}">${href}</a></p>`,
    `<p>${escapeHtml(section.expires)}<br>${escapeHtml(section.ignore)}</p>`,
    `</div>`,
  ].join("\n");
}

export async function renderInvitationEmail(input: InvitationEmailInput): Promise<MailMessage> {
  const locales = input.locales.length > 0 ? input.locales : (["vi"] as const);
  const sections = await Promise.all(locales.map((locale) => renderSection(locale, input)));
  const pairs = sections.map((section, index) => ({ section, locale: locales[index]! }));
  return {
    to: input.to,
    subject: sections.map((section) => section.subject).join(SUBJECT_SEPARATOR),
    text: pairs.map(({ section }) => sectionText(section, input.acceptUrl)).join("\n\n---\n\n"),
    html: [
      "<!doctype html>",
      `<html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111827">`,
      pairs
        .map(({ section, locale }) => sectionHtml(section, input.acceptUrl, locale))
        .join('\n<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">\n'),
      "</body></html>",
    ].join("\n"),
  };
}
