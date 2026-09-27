/**
 * `@kb/emails` — transactional email templates built with React Email (MIT). Templates take
 * already-translated strings (from `@kb/i18n`) as props and hold no text of their own.
 */
export {
  InvitationEmail,
  type InvitationEmailProps,
  type InvitationEmailSection,
} from "./invitation-email";
export { renderEmail, type RenderedEmail } from "./render";
export { emailTheme } from "./theme";
