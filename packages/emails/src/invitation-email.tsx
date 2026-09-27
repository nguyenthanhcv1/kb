import { Body } from "@react-email/body";
import { Button } from "@react-email/button";
import { Container } from "@react-email/container";
import { Head } from "@react-email/head";
import { Heading } from "@react-email/heading";
import { Hr } from "@react-email/hr";
import { Html } from "@react-email/html";
import { Link } from "@react-email/link";
import { Preview } from "@react-email/preview";
import { Section } from "@react-email/section";
import { Text } from "@react-email/text";
import { Fragment } from "react";

import { emailTheme as c } from "./theme";

/**
 * Already-translated strings of one language block. The template holds no text of its own: the
 * caller (kb-web, `server/email/invitation-email.ts`) fills these from `email.invitation.*` in
 * `@kb/i18n`, so the email follows the same vi/en catalogue as the app.
 */
export interface InvitationEmailSection {
  /** BCP 47 tag of this block (`vi`, `en`), set as `lang` so readers and screen readers switch. */
  lang: string;
  title: string;
  greeting: string;
  body: string;
  signInHint: string;
  accept: string;
  linkFallback: string;
  expires: string;
  ignore: string;
}

export interface InvitationEmailProps {
  acceptUrl: string;
  /** One block per language, in order (invitee without an account: Vietnamese then English). */
  sections: readonly InvitationEmailSection[];
  /** Inbox preview line (defaults to the first block's body). */
  preview?: string;
}

const text = { margin: "0 0 16px", fontSize: "15px", lineHeight: "24px", color: c.foreground };
const small = { margin: "0 0 8px", fontSize: "13px", lineHeight: "20px", color: c.muted };

function InvitationSection({
  section,
  acceptUrl,
}: {
  section: InvitationEmailSection;
  acceptUrl: string;
}) {
  return (
    <Section lang={section.lang} style={{ padding: "8px 0" }}>
      <Heading
        as="h1"
        style={{ margin: "0 0 16px", fontSize: "20px", lineHeight: "28px", color: c.foreground }}
      >
        {section.title}
      </Heading>
      <Text style={text}>{section.greeting}</Text>
      <Text style={text}>{section.body}</Text>
      <Text style={text}>{section.signInHint}</Text>
      <Section style={{ margin: "8px 0 24px" }}>
        <Button
          href={acceptUrl}
          style={{
            display: "inline-block",
            padding: "12px 20px",
            borderRadius: "6px",
            backgroundColor: c.primary,
            color: c.primaryForeground,
            fontSize: "15px",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          {section.accept}
        </Button>
      </Section>
      <Text style={small}>{section.linkFallback}</Text>
      <Text style={{ ...small, margin: "0 0 16px", wordBreak: "break-all" }}>
        <Link href={acceptUrl} style={{ color: c.link, textDecoration: "underline" }}>
          {acceptUrl}
        </Link>
      </Text>
      <Text style={small}>{section.expires}</Text>
      <Text style={small}>{section.ignore}</Text>
    </Section>
  );
}

/** Space invitation email (docs/PLAN.md §9 T1.5): one block per language, same accept link. */
export function InvitationEmail({ acceptUrl, sections, preview }: InvitationEmailProps) {
  const first = sections[0];
  return (
    <Html lang={first?.lang ?? "vi"}>
      <Head />
      {(preview ?? first?.body) && <Preview>{preview ?? first?.body ?? ""}</Preview>}
      <Body
        style={{
          margin: 0,
          padding: "24px 12px",
          backgroundColor: c.background,
          fontFamily: c.fontFamily,
        }}
      >
        <Container
          style={{
            maxWidth: "560px",
            padding: "24px",
            borderRadius: "8px",
            border: `1px solid ${c.border}`,
            backgroundColor: c.card,
          }}
        >
          {sections.map((section, index) => (
            <Fragment key={section.lang}>
              {index > 0 && <Hr style={{ margin: "24px 0", borderColor: c.border }} />}
              <InvitationSection section={section} acceptUrl={acceptUrl} />
            </Fragment>
          ))}
        </Container>
      </Body>
    </Html>
  );
}
