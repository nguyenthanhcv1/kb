import { InvitationEmail, renderEmail, type InvitationEmailSection } from "@kb/emails";
import { defaultTimeZone, loadMessages, type Locale } from "@kb/i18n";
import { createFormatter, createTranslator } from "next-intl";
import { createElement } from "react";

import type { MailMessage } from "./mailer";

/**
 * Bilingual invitation email: the React Email template `InvitationEmail` (`@kb/emails`, T1.5b)
 * filled with `email.invitation.*` / `space.roles.*` in the recipient's language(s). With several
 * locales (invitee has no account yet → `["vi", "en"]`, docs/PLAN.md §5 "Email"), the email holds
 * one block per locale, Vietnamese first, and the subject joins both.
 */
export interface InvitationEmailInput {
  to: string;
  locales: readonly Locale[];
  inviterName: string;
  spaceName: string;
  /** Set for a page share invitation: the email names the page instead of the whole Space. */
  pageTitle?: string;
  role: "viewer" | "editor";
  acceptUrl: string;
  expiresAt: string;
  timeZone?: string;
}

/** "A page was shared with you" — for people who already have an account (no invitation). */
export interface PageSharedEmailInput {
  to: string;
  locales: readonly Locale[];
  sharerName: string;
  spaceName: string;
  pageTitle: string;
  role: "viewer" | "editor";
  pageUrl: string;
}

const SUBJECT_SEPARATOR = " / ";

async function renderSection(
  locale: Locale,
  input: InvitationEmailInput,
): Promise<InvitationEmailSection & { subject: string }> {
  const messages = await loadMessages(locale, ["email", "space"]);
  const timeZone = input.timeZone ?? defaultTimeZone;
  const t = createTranslator({
    locale,
    messages,
    namespace: input.pageTitle === undefined ? "email.invitation" : "email.pageInvitation",
  });
  const tRoles = createTranslator({ locale, messages, namespace: "space.roles" });
  const format = createFormatter({ locale, timeZone });
  const date = format.dateTime(new Date(input.expiresAt), {
    dateStyle: "long",
    timeStyle: "short",
    timeZone,
  });
  const params = {
    inviter: input.inviterName,
    space: input.spaceName,
    ...(input.pageTitle === undefined ? {} : { page: input.pageTitle || t("untitled") }),
  };
  const subject = t("subject", params);
  return {
    lang: locale,
    subject,
    title: subject,
    greeting: t("greeting"),
    body: t("body", { ...params, role: tRoles(input.role) }),
    signInHint: t("signInHint", { email: input.to }),
    accept: t("accept"),
    linkFallback: t("linkFallback"),
    expires: t("expires", { date }),
    ignore: t("ignore"),
  };
}

export async function renderInvitationEmail(input: InvitationEmailInput): Promise<MailMessage> {
  const locales = input.locales.length > 0 ? input.locales : (["vi"] as const);
  const sections = await Promise.all(locales.map((locale) => renderSection(locale, input)));
  const { html, text } = await renderEmail(
    createElement(InvitationEmail, { acceptUrl: input.acceptUrl, sections }),
  );
  return {
    to: input.to,
    subject: sections.map((section) => section.subject).join(SUBJECT_SEPARATOR),
    text,
    html,
  };
}

async function renderPageSharedSection(
  locale: Locale,
  input: PageSharedEmailInput,
): Promise<InvitationEmailSection & { subject: string }> {
  const messages = await loadMessages(locale, ["email", "space"]);
  const t = createTranslator({ locale, messages, namespace: "email.pageShared" });
  const tRoles = createTranslator({ locale, messages, namespace: "space.roles" });
  const params = {
    sharer: input.sharerName,
    space: input.spaceName,
    page: input.pageTitle || t("untitled"),
  };
  const subject = t("subject", params);
  return {
    lang: locale,
    subject,
    title: subject,
    greeting: t("greeting"),
    body: t("body", { ...params, role: tRoles(input.role) }),
    signInHint: t("signInHint", { email: input.to }),
    accept: t("open"),
    linkFallback: t("linkFallback"),
    ignore: t("ignore"),
  };
}

export async function renderPageSharedEmail(input: PageSharedEmailInput): Promise<MailMessage> {
  const locales = input.locales.length > 0 ? input.locales : (["vi"] as const);
  const sections = await Promise.all(
    locales.map((locale) => renderPageSharedSection(locale, input)),
  );
  const { html, text } = await renderEmail(
    createElement(InvitationEmail, { acceptUrl: input.pageUrl, sections }),
  );
  return {
    to: input.to,
    subject: sections.map((section) => section.subject).join(SUBJECT_SEPARATOR),
    text,
    html,
  };
}
