import { expect, test as base } from "@playwright/test";

/**
 * `test` with i18n guards (docs/PLAN.md §8 "i18n E2E"): a next-intl `MISSING_MESSAGE` /
 * `INVALID_MESSAGE` reaching the browser console, or an uncaught page error, fails the test.
 * Server-side `MISSING_MESSAGE` logs are checked once per run by the workflow (it greps the web
 * server log). New specs import `test`/`expect` from here instead of `@playwright/test`.
 */
export const test = base.extend<{ guards: void }>({
  guards: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (message) => {
        const text = message.text();
        if (message.type() === "error" && /MISSING_MESSAGE|INVALID_MESSAGE/.test(text)) {
          problems.push(text);
        }
      });
      page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
      await use();
      expect(problems, "i18n / uncaught errors in the browser").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
