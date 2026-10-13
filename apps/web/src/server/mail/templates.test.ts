import { describe, expect, it } from "vitest";

import { buildAccountDecisionEmail } from "./templates";

describe("buildAccountDecisionEmail", () => {
  it("links approved people to the app, in their language", async () => {
    const vi = await buildAccountDecisionEmail({
      locale: "vi",
      decision: "approved",
      appUrl: "https://kb.example",
    });
    expect(vi.subject).toContain("đã được duyệt");
    expect(vi.text).toContain("https://kb.example");
    const en = await buildAccountDecisionEmail({
      locale: "en",
      decision: "approved",
      appUrl: "https://kb.example",
    });
    expect(en.subject).toContain("approved");
    expect(en.html).toContain("https://kb.example");
  });

  it("includes the reason of a rejection only when there is one, escaped in the html", async () => {
    const withReason = await buildAccountDecisionEmail({
      locale: "en",
      decision: "rejected",
      reason: "<b>Not ours</b>",
      appUrl: "https://kb.example",
    });
    expect(withReason.text).toContain("Reason: <b>Not ours</b>");
    expect(withReason.html).toContain("&lt;b&gt;Not ours&lt;/b&gt;");

    const without = await buildAccountDecisionEmail({
      locale: "en",
      decision: "rejected",
      appUrl: "https://kb.example",
    });
    expect(without.text).not.toContain("Reason");
  });
});
