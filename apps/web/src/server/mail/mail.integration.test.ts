/**
 * Real SMTP round trip through Mailpit (`supabase start` includes it):
 *   MAIL_TEST_SMTP_PORT=54325 MAIL_TEST_MAILPIT_URL=http://127.0.0.1:54324 (SMTP host: MAIL_TEST_SMTP_HOST,
 *   default 127.0.0.1; the port is exposed by `[local_smtp] smtp_port` in supabase/config.toml)
 * Skipped when unset.
 */
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createMailer } from "./index";
import { buildTestEmail } from "./templates";

const PORT = process.env.MAIL_TEST_SMTP_PORT;
const MAILPIT = process.env.MAIL_TEST_MAILPIT_URL;

describe.skipIf(!PORT || !MAILPIT)("SMTP mailer through Mailpit", () => {
  it("delivers the bilingual test email with its HTML alternative", async () => {
    const to = `mail-test-${randomUUID()}@example.com`;
    const send = createMailer({
      host: process.env.MAIL_TEST_SMTP_HOST ?? "127.0.0.1",
      port: Number(PORT),
      secure: "none",
      from: "KB <kb@example.com>",
      replyTo: "ops@example.com",
    });
    const content = await buildTestEmail({ locale: "vi", sender: "admin@example.com" });
    await send({ to, ...content });

    let message: { ID: string; Subject: string } | undefined;
    for (let attempt = 0; attempt < 20 && !message; attempt++) {
      const response = await fetch(
        `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
      );
      const body = (await response.json()) as { messages: { ID: string; Subject: string }[] };
      message = body.messages[0];
      if (!message) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(message?.Subject).toBe("Email thử từ KB");

    const detail = (await (await fetch(`${MAILPIT}/api/v1/message/${message!.ID}`)).json()) as {
      Text: string;
      HTML: string;
      ReplyTo: { Address: string }[];
    };
    expect(detail.Text).toContain("admin@example.com");
    expect(detail.HTML).toContain("<p>");
    expect(detail.ReplyTo[0]?.Address).toBe("ops@example.com");
  });
});
