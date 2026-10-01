import { baseUrl, e2eLocale } from "../support/env";
import { message } from "../support/messages";
import { expect, test } from "../support/test";

/**
 * T7.1b — smoke suite run by CI in both locales (`E2E_LOCALE=vi|en`): the app is up, the
 * unauthenticated entry point renders in the selected language and shows no missing messages.
 */
const locale = e2eLocale();

test("health endpoint reports ok", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ status: "ok" });
});

test(`signed-out visitors land on the login page in ${locale}`, async ({ page, context }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseUrl() }]);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  const { app } = message<{ app: { name: string } }>(locale, "common");
  await expect(page.getByText(app.name).first()).toBeVisible();
});
