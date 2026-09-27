import { describe, expect, it } from "vitest";

import { InvitationEmail, type InvitationEmailSection } from "./invitation-email";
import { renderEmail } from "./render";

const section = (lang: string, marker: string): InvitationEmailSection => ({
  lang,
  title: `${marker} title`,
  greeting: `${marker} greeting`,
  body: `${marker} body <Design> & co`,
  signInHint: `${marker} sign in`,
  accept: `${marker} accept`,
  linkFallback: `${marker} fallback`,
  expires: `${marker} expires`,
  ignore: `${marker} ignore`,
});

const URL = "https://kb.example.com/invite/abc_DEF-123";

describe("InvitationEmail", () => {
  it("renders one block per language with the accept link, escaped", async () => {
    const { html, text } = await renderEmail(
      <InvitationEmail acceptUrl={URL} sections={[section("vi", "VI"), section("en", "EN")]} />,
    );
    expect(html).toMatch(/^<!DOCTYPE html/i);
    expect(html).toMatch(/<html[^>]* lang="vi"/);
    expect(html).toContain('lang="vi"');
    expect(html).toContain('lang="en"');
    expect(html.indexOf("VI accept")).toBeLessThan(html.indexOf("EN accept"));
    expect(html).toContain("&lt;Design&gt; &amp; co");
    expect(html).not.toContain("<Design>");
    expect(html.match(new RegExp(`href="${URL}"`, "g"))?.length).toBe(4);
    expect(text).toContain("VI greeting");
    expect(text).toContain("EN ignore");
    expect(text).toContain(URL);
  });

  it("renders a single language when only one block is given", async () => {
    const { html } = await renderEmail(
      <InvitationEmail acceptUrl={URL} sections={[section("en", "EN")]} />,
    );
    expect(html).toMatch(/<html[^>]* lang="en"/);
    expect(html).not.toContain('lang="vi"');
    expect(html).not.toContain("<hr");
  });
});
