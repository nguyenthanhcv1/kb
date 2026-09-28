import { createRequire } from "node:module";

import type viAdmin from "@kb/i18n/messages/vi/admin.json";
import type viAuth from "@kb/i18n/messages/vi/auth.json";
import type viNav from "@kb/i18n/messages/vi/nav.json";
import { expect, test } from "@playwright/test";

/**
 * T1.7b — Administration: reach `/admin/access` from the account menu, add an email and a domain
 * to the allowlist (bulk input, public-domain confirmation), remove them with the impact preview,
 * and see the user list. Labels come from the message files (vi and en).
 *
 * Needs a signed-in **super admin**: set `E2E_SUPER_ADMIN_STORAGE_STATE` to a Playwright storage
 * state file holding the Supabase session cookies (the signed-in fixtures arrive with T7.1b).
 * Without it the spec is skipped.
 */
const STORAGE_STATE = process.env.E2E_SUPER_ADMIN_STORAGE_STATE;
const BASE_URL = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000").origin;

const require = createRequire(import.meta.url);
type Messages = { admin: typeof viAdmin; auth: typeof viAuth; nav: typeof viNav };
const messages: Record<"vi" | "en", Messages> = {
  vi: {
    admin: require("@kb/i18n/messages/vi/admin.json"),
    auth: require("@kb/i18n/messages/vi/auth.json"),
    nav: require("@kb/i18n/messages/vi/nav.json"),
  },
  en: {
    admin: require("@kb/i18n/messages/en/admin.json"),
    auth: require("@kb/i18n/messages/en/auth.json"),
    nav: require("@kb/i18n/messages/en/nav.json"),
  },
};

/** Fills `{name}`-style ICU arguments of a simple message (no plural/select). */
function format(message: string, values: Record<string, string>): string {
  return message.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

test.skip(
  !STORAGE_STATE,
  "E2E_SUPER_ADMIN_STORAGE_STATE is not set (signed-in super admin, see T7.1b)",
);
test.use({ storageState: STORAGE_STATE });

for (const locale of ["vi", "en"] as const) {
  test(`manage the allowlist and see users (${locale})`, async ({ page, context }) => {
    const m = messages[locale];
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: BASE_URL }]);
    const suffix = `${locale}-${Date.now().toString(36)}`;
    const email = `e2e-${suffix}@example.com`;
    const domain = `e2e-${suffix}.example.com`;

    // Entry point: account menu → Administration → Access.
    await page.goto("/");
    await page.getByRole("button", { name: m.auth.userMenu.open }).click();
    await page.getByRole("menuitem", { name: m.nav.admin }).click();
    await expect(page).toHaveURL("/admin/access");
    await expect(page.getByRole("heading", { level: 1, name: m.admin.title })).toBeVisible();

    // A public email domain needs the explicit confirmation; remove it from the input instead.
    const input = page.getByLabel(m.admin.access.add.inputLabel);
    await input.fill(`${email}, gmail.com`);
    await expect(page.getByLabel(m.admin.access.add.confirmPublic)).toBeVisible();
    await page.getByRole("button", { name: m.admin.access.add.submit }).click();
    await expect(page.getByText(m.admin.access.add.publicConfirmRequired)).toBeVisible();

    await input.fill(`${email}\n${domain}`);
    await page.getByRole("button", { name: m.admin.access.add.submit }).click();
    const list = page.getByRole("region", { name: m.admin.access.list.title });
    await expect(list.getByText(email, { exact: true })).toBeVisible();
    await expect(list.getByText(domain, { exact: true })).toBeVisible();

    // Remove both, each after the impact preview.
    for (const value of [email, domain]) {
      await list
        .getByRole("button", { name: format(m.admin.access.list.removeLabel, { value }) })
        .click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toContainText(value);
      await expect(
        dialog.getByRole("button", { name: m.admin.access.remove.confirm }),
      ).toBeEnabled();
      await dialog.getByRole("button", { name: m.admin.access.remove.confirm }).click();
      await expect(list.getByText(value, { exact: true })).toHaveCount(0);
    }

    // Users: the signed-in super admin is listed with the super admin badge.
    await page.getByRole("link", { name: m.admin.users.title }).click();
    await expect(page).toHaveURL("/admin/users");
    await expect(page.getByText(m.admin.users.self, { exact: true })).toBeVisible();
    await page.getByRole("link", { name: m.admin.users.status.deactivated }).click();
    await expect(page).toHaveURL("/admin/users?status=deactivated");
  });
}
