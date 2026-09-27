import { describe, expect, it } from "vitest";

import { defaultSecureMode, mailConfigFromEnv, toMessageHeaders, type MailConfig } from "./index";
import { buildTestEmail, textToHtml } from "./templates";

const baseEnv = {
  SMTP_HOST: "smtp.gmail.com",
  SMTP_PORT: 587,
  SMTP_SECURE: undefined,
  SMTP_USER: "kb@ahamove.com",
  SMTP_PASSWORD: "app-password",
  SMTP_FROM: "KB <kb@ahamove.com>",
  SMTP_REPLY_TO: undefined,
};

describe("mailConfigFromEnv", () => {
  it("is null without a host or a sender", () => {
    expect(mailConfigFromEnv({ ...baseEnv, SMTP_HOST: undefined })).toBeNull();
    expect(mailConfigFromEnv({ ...baseEnv, SMTP_FROM: undefined })).toBeNull();
  });

  it("derives the security mode from the port unless SMTP_SECURE is set", () => {
    expect(mailConfigFromEnv(baseEnv)?.secure).toBe("starttls");
    expect(mailConfigFromEnv({ ...baseEnv, SMTP_PORT: 465 })?.secure).toBe("ssl");
    expect(mailConfigFromEnv({ ...baseEnv, SMTP_PORT: 54325 })?.secure).toBe("none");
    expect(mailConfigFromEnv({ ...baseEnv, SMTP_SECURE: "none" })?.secure).toBe("none");
    expect(defaultSecureMode(25)).toBe("none");
  });
});

describe("toMessageHeaders", () => {
  const config: MailConfig = {
    host: "h",
    port: 587,
    secure: "starttls",
    from: "KB <kb@ahamove.com>",
    replyTo: "ops@ahamove.com",
  };

  it("sets from/reply-to from the config and adds the HTML alternative", () => {
    expect(
      toMessageHeaders(config, { to: "an@x.com", subject: "S", text: "T", html: "<p>T</p>" }),
    ).toEqual({
      from: "KB <kb@ahamove.com>",
      to: "an@x.com",
      subject: "S",
      text: "T",
      "reply-to": "ops@ahamove.com",
      attachment: [{ data: "<p>T</p>", alternative: true }],
    });
    expect(
      toMessageHeaders(
        { ...config, replyTo: undefined },
        { to: "a@x.com", subject: "S", text: "T" },
      ),
    ).toEqual({ from: config.from, to: "a@x.com", subject: "S", text: "T" });
  });
});

describe("templates", () => {
  it("escapes text into paragraphs", () => {
    expect(textToHtml("a <b>\nc\n\nd & e")).toBe("<p>a &lt;b&gt;<br>c</p>\n<p>d &amp; e</p>");
  });

  it("renders the test email in the recipient's locale", async () => {
    const sentAt = new Date("2026-09-27T03:04:00Z");
    const vi = await buildTestEmail({ locale: "vi", sender: "an@ahamove.com", sentAt });
    const en = await buildTestEmail({ locale: "en", sender: "an@ahamove.com", sentAt });
    expect(vi.subject).toBe("Email thử từ KB");
    expect(en.subject).toBe("Test email from KB");
    expect(vi.text).toContain("an@ahamove.com");
    expect(en.text).toContain("an@ahamove.com");
    // Asia/Ho_Chi_Minh is UTC+7.
    expect(en.text).toContain("10:04");
    expect(en.html).toMatch(/^<p>This is a test email/);
  });
});
