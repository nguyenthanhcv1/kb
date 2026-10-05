import { createRequire } from "node:module";

import type viErrors from "@kb/i18n/messages/vi/errors.json";
import type viMembers from "@kb/i18n/messages/vi/members.json";
import type viSpace from "@kb/i18n/messages/vi/space.json";
import { expect, type BrowserContext, type Page, test } from "@playwright/test";
import { useLocale } from "../support/locale";
import { setProfileLocale } from "../support/users";
import { createServerClient } from "@supabase/ssr";

/**
 * T1.5b — Space members and guest invitations: invite a guest by email → the guest signs in and
 * accepts on /invite/<token> → lands in the Space; the link is single-use; an expired link and a
 * revoked invitation show translated errors; the admin sees and removes the guest.
 *
 * Needs:
 * - `E2E_STORAGE_STATE`: Playwright storage state of a signed-in internal user (see space.spec.ts);
 * - `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`, `E2E_SUPABASE_SERVICE_ROLE_KEY` (local stack:
 *   `supabase status`) to create the invited guest with a password, sign them in and age an
 *   invitation. Email/password sign-in must be enabled (it is in `supabase/config.toml`).
 * - optional `E2E_MEMBER_QUERY`: name/email fragment of an internal user outside the new Space,
 *   to also cover "add member".
 * Without them the spec is skipped.
 */
const STORAGE_STATE = process.env.E2E_STORAGE_STATE;
const SUPABASE_URL = process.env.E2E_SUPABASE_URL;
const ANON_KEY = process.env.E2E_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
const MEMBER_QUERY = process.env.E2E_MEMBER_QUERY;
const BASE_URL = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000").origin;

const require = createRequire(import.meta.url);
type Messages = { members: typeof viMembers; space: typeof viSpace; errors: typeof viErrors };
const load = (locale: "vi" | "en"): Messages => ({
  members: require(`@kb/i18n/messages/${locale}/members.json`),
  space: require(`@kb/i18n/messages/${locale}/space.json`),
  errors: require(`@kb/i18n/messages/${locale}/errors.json`),
});
const messages = { vi: load("vi"), en: load("en") };

test.skip(
  !STORAGE_STATE || !SUPABASE_URL || !ANON_KEY || !SERVICE_KEY,
  "E2E_STORAGE_STATE / E2E_SUPABASE_* are not set (signed-in internal user + local Supabase)",
);
test.use({ storageState: STORAGE_STATE });

async function admin(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response;
}

/** Creates the invited guest (allowed by the sign-in hook: pending invitation) and signs them in. */
async function signInGuest(context: BrowserContext, email: string, name: string) {
  const password = `pw-${Date.now().toString(36)}`;
  await admin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name },
    }),
  });
  const jar = new Map<string, string>();
  const client = createServerClient(SUPABASE_URL!, ANON_KEY!, {
    cookies: {
      getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
      setAll: (list) => list.forEach(({ name: n, value }) => jar.set(n, value)),
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  await context.addCookies([...jar].map(([n, value]) => ({ name: n, value, url: BASE_URL })));
}

async function createSpace(page: Page, m: Messages, name: string) {
  await page.goto("/");
  await page.getByRole("main").getByRole("button", { name: m.space.create }).first().click();
  const dialog = page.getByRole("dialog", { name: m.space.create });
  await dialog.getByLabel(m.space.form.name).fill(name);
  const slug = await dialog.getByLabel(m.space.form.slug).inputValue();
  await dialog.getByRole("button", { name: m.space.createDialog.submit }).click();
  await expect(page).toHaveURL(`/s/${slug}`);
  return slug;
}

async function invite(page: Page, m: Messages, email: string): Promise<string> {
  await page.getByLabel(m.members.invite.emailLabel).fill(email);
  await page.getByRole("button", { name: m.members.invite.submit }).click();
  const link = page.getByLabel(m.members.invite.linkLabel);
  await expect(link).toHaveValue(/\/invite\/[A-Za-z0-9_-]+$/);
  return link.inputValue();
}

for (const locale of ["vi", "en"] as const) {
  test(`invite a guest, accept once, expire and revoke (${locale})`, async ({
    page,
    context,
    browser,
  }, testInfo) => {
    const m = messages[locale];
    await useLocale(context, locale);
    // Unique per worker, repeat and retry: parallel runs must not share a Space or a guest email.
    const suffix = `${locale}-${Date.now().toString(36)}${testInfo.parallelIndex}${testInfo.repeatEachIndex}${testInfo.retry}`;
    const spaceName = `Team ${suffix}`;
    const slug = await createSpace(page, m, spaceName);

    // Members settings: tab, own row.
    await page.goto(`/s/${slug}/settings`);
    await page
      .getByRole("navigation", { name: m.space.settingsPage.navLabel })
      .getByRole("link", { name: m.space.members })
      .click();
    await expect(page).toHaveURL(`/s/${slug}/settings/members`);
    const members = page.getByRole("list", { name: m.members.list.title });
    await expect(members.getByText(m.members.list.you)).toBeVisible();

    if (MEMBER_QUERY) {
      await page.getByLabel(m.members.add.searchLabel).fill(MEMBER_QUERY);
      const results = page.getByRole("list", { name: m.members.add.results });
      await results.getByRole("button").first().click();
      await expect(members.getByRole("listitem")).toHaveCount(2);
    }

    // Invite a guest; the pending invitation is listed.
    const guestEmail = `guest-${suffix}@partner.test`;
    const inviteUrl = await invite(page, m, guestEmail);
    await expect(page.getByText(guestEmail)).toBeVisible();

    // The guest signs in and accepts → lands in the Space.
    const guestContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    await guestContext.addCookies([{ name: "NEXT_LOCALE", value: locale, url: BASE_URL }]);
    await signInGuest(guestContext, guestEmail, `Partner ${suffix}`);
    await setProfileLocale(locale, guestEmail);
    const guest = await guestContext.newPage();
    await guest.goto(inviteUrl);
    await expect(guest.getByRole("heading", { name: m.members.invitePage.title })).toBeVisible();
    await expect(guest.getByText(spaceName).first()).toBeVisible();
    await guest.getByRole("button", { name: m.members.invitePage.accept }).click();
    await expect(guest).toHaveURL(`/s/${slug}`);
    await expect(guest.getByRole("heading", { level: 1, name: spaceName })).toBeVisible();

    // Single use: the same link now says it was used.
    await guest.goto(inviteUrl);
    await expect(guest.getByText(m.errors.INVITATION_ALREADY_USED)).toBeVisible();
    await guestContext.close();

    // The admin sees the guest as a member; the invitation is no longer pending.
    await page.reload();
    const guestRow = members.getByRole("listitem").filter({ hasText: `Partner ${suffix}` });
    await expect(guestRow.getByText(m.members.list.guest, { exact: true })).toBeVisible();
    await expect(page.getByText(guestEmail)).toHaveCount(1);

    // Expired link → translated error.
    const lateEmail = `late-${suffix}@partner.test`;
    const lateUrl = await invite(page, m, lateEmail);
    await admin(`/rest/v1/invitations?email=eq.${encodeURIComponent(lateEmail)}`, {
      method: "PATCH",
      body: JSON.stringify({ expires_at: new Date(Date.now() - 60_000).toISOString() }),
    });
    await page.goto(lateUrl);
    await expect(page.getByText(m.errors.INVITATION_EXPIRED)).toBeVisible();

    // Revoke → gone from the list, its link says revoked.
    await page.goto(`/s/${slug}/settings/members`);
    const revokeEmail = `revoke-${suffix}@partner.test`;
    const revokeUrl = await invite(page, m, revokeEmail);
    await page
      .getByRole("button", {
        name: m.members.invitations.revokeLabel.replace("{email}", revokeEmail),
      })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: m.members.invitations.revoke })
      .click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByRole("listitem").filter({ hasText: revokeEmail })).toHaveCount(0);
    await page.goto(revokeUrl);
    await expect(page.getByText(m.errors.INVITATION_REVOKED)).toBeVisible();

    // Remove the guest.
    await page.goto(`/s/${slug}/settings/members`);
    const guestName = `Partner ${suffix}`;
    await page
      .getByRole("button", { name: m.members.list.removeLabel.replace("{name}", guestName) })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: m.members.list.remove })
      .click();
    await expect(members.getByRole("listitem").filter({ hasText: guestName })).toHaveCount(0);
  });
}
