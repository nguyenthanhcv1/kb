import type viMembers from "@kb/i18n/messages/vi/members.json";
import type viNav from "@kb/i18n/messages/vi/nav.json";

import { createUser } from "../support/auth";
import { baseUrl, e2eLocale, supabaseEnv } from "../support/env";
import { useLocale } from "../support/locale";
import { message } from "../support/messages";
import {
  addPage,
  createSpace,
  openPage,
  signIn,
  uniqueSuffix,
  type TestUser,
} from "../support/space";
import { expect, test } from "../support/test";
import { setProfileLocale } from "../support/users";

/**
 * Page sharing: a Space admin shares one page by email with someone who has no account → they
 * sign up through the page invitation, accept it and land on the page; they see it under "Shared
 * with me", but not the other pages or the Space itself, and get no "Share" button; once the
 * admin stops sharing, the page is gone for them.
 *
 * Needs `E2E_STORAGE_STATE` and `E2E_SUPABASE_*` (local stack, see global-setup.ts); skipped
 * otherwise.
 */
const STORAGE_STATE = process.env.E2E_STORAGE_STATE;

test.skip(
  !STORAGE_STATE || !supabaseEnv(),
  "E2E_STORAGE_STATE / E2E_SUPABASE_* are not set (signed-in internal user + local Supabase)",
);
test.use({ storageState: STORAGE_STATE });

const m = {
  members: message<typeof viMembers>(e2eLocale(), "members"),
  nav: message<typeof viNav>(e2eLocale(), "nav"),
};

test("share a page with a guest who only sees that page", async ({
  page,
  context,
  browser,
}, testInfo) => {
  await useLocale(context, e2eLocale());
  const suffix = uniqueSuffix(testInfo);
  const slug = await createSpace(page, `Share ${suffix}`);
  const sharedTitle = `Contract ${suffix}`;
  const privateTitle = `Internal ${suffix}`;
  await addPage(page, sharedTitle);
  await addPage(page, privateTitle);
  const open = async (title: string) => {
    await openPage(page, title);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    return new URL(page.url()).pathname;
  };
  const privatePath = await open(privateTitle);
  const sharedPath = await open(sharedTitle);

  // The admin shares the page with an email that has no account yet → page invitation link.
  const guest: TestUser = {
    email: `guest-${suffix}@partner.test`,
    password: `pw-${suffix}`,
    name: `Guest ${suffix}`,
  };
  await page.getByRole("button", { name: m.members.pageShare.buttonLabel }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(m.members.pageShare.emailLabel).fill(guest.email);
  await dialog.getByRole("button", { name: m.members.pageShare.submit, exact: true }).click();
  const link = dialog.getByLabel(m.members.invite.linkLabel);
  await expect(link).toHaveValue(/\/invite\/[A-Za-z0-9_-]+$/);
  const inviteUrl = await link.inputValue();
  await expect(dialog.getByText(guest.email, { exact: true })).toBeVisible();

  // The guest signs up (allowed by the pending invitation), accepts and lands on the page.
  const env = supabaseEnv()!;
  await createUser(env, guest);
  await setProfileLocale(e2eLocale(), guest.email);
  const guestContext = await browser.newContext({
    baseURL: baseUrl(),
    locale: e2eLocale() === "en" ? "en-US" : "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  });
  await signIn(guestContext, guest);
  const guestPage = await guestContext.newPage();
  await guestPage.goto(new URL(inviteUrl).pathname);
  await expect(
    guestPage.getByRole("heading", { name: m.members.invitePage.pageTitle }),
  ).toBeVisible();
  await guestPage.getByRole("button", { name: m.members.invitePage.accept }).click();
  await expect(guestPage).toHaveURL(sharedPath);
  await expect(guestPage.getByRole("heading", { level: 1, name: sharedTitle })).toBeVisible();

  // "Shared with me" lists it; no Share button, no access to the rest of the Space.
  const shared = guestPage.getByRole("region", { name: m.nav.shared.heading });
  await expect(shared.getByRole("link", { name: new RegExp(sharedTitle) })).toBeVisible();
  await expect(
    guestPage.getByRole("button", { name: m.members.pageShare.buttonLabel }),
  ).toHaveCount(0);
  await guestPage.goto(privatePath);
  await expect(guestPage.getByRole("heading", { level: 1, name: privateTitle })).toHaveCount(0);
  const spaceResponse = await guestPage.goto(`/s/${slug}`);
  expect(spaceResponse?.status()).toBe(404);

  // The admin sees the guest and stops sharing; the page disappears for the guest.
  await page.reload();
  await page.getByRole("button", { name: m.members.pageShare.buttonLabel }).click();
  const people = page.getByRole("list", { name: m.members.pageShare.peopleTitle });
  const removeLabel = m.members.pageShare.removeLabel.replace("{name}", guest.name);
  await people.getByRole("button", { name: removeLabel }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: m.members.pageShare.remove })
    .click();
  await expect(people).toHaveCount(0);

  const goneResponse = await guestPage.goto(sharedPath);
  expect(goneResponse?.status()).toBe(404);
  await guestContext.close();
});
