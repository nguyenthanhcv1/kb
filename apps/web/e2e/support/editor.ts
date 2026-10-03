import type viEditor from "@kb/i18n/messages/vi/editor.json";
import type viSpace from "@kb/i18n/messages/vi/space.json";
import type viTable from "@kb/i18n/messages/vi/table.json";
import type viTree from "@kb/i18n/messages/vi/tree.json";
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";

import { adminFetch, allowEmail, createUser, signInCookies } from "./auth";
import { type E2ELocale, e2eLocale, supabaseEnv } from "./env";
import { useLocale as setLocale } from "./locale";
import { message } from "./messages";
import { expect, test as base } from "./test";
import { setProfileLocale } from "./users";

/**
 * Fixtures for the editor and table specs (T7.1c). Every test gets its own Space with one empty
 * page, created through the UI as the worker's signed-in user (so no `E2E_EDITOR_PATH` /
 * `E2E_PAGE_PATH` has to be prepared), and opens the editor once it is editable and saved.
 */
type Messages = {
  editor: typeof viEditor;
  space: typeof viSpace;
  tree: typeof viTree;
  table: typeof viTable;
};

export function loadMessages(locale: E2ELocale = e2eLocale()): Messages {
  return {
    editor: message(locale, "editor"),
    space: message(locale, "space"),
    tree: message(locale, "tree"),
    table: message(locale, "table"),
  };
}

export type EditorFixture = {
  locale: E2ELocale;
  m: Messages;
  editor: Locator;
  /** `/s/<slug>` of the Space created for the test. */
  spacePath: string;
  /** Path of the page (`/s/<slug>/p/<ref>`). */
  pagePath: string;
  /** Slug of the Space, unique per test. */
  spaceSlug: string;
};

/** Waits until the collaboration session is connected and everything typed is saved. */
export async function waitForSaved(page: Page) {
  await expect(page.locator('[data-status="saved"]')).toBeVisible();
}

/** The editable content area, once the collaboration session is connected and saved. */
export async function waitForEditor(page: Page, locale: E2ELocale = e2eLocale()) {
  const m = loadMessages(locale);
  const editor = page.getByRole("textbox", { name: m.editor.content.label });
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await waitForSaved(page);
  return editor;
}

/** Moves the caret to a new empty line after the last block. */
export async function newLine(page: Page, editor: Locator) {
  await editor.locator(":scope > *").last().click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
}

export const test = base.extend<{ doc: EditorFixture }>({
  doc: async ({ page, context }, provide, testInfo) => {
    const locale = e2eLocale();
    const m = loadMessages(locale);
    await setLocale(context, locale);
    const unique = `${Date.now().toString(36)}${testInfo.parallelIndex}${testInfo.retry}`;
    const spaceSlug = `ed-${locale}-${unique}`;

    await page.goto("/");
    await page.getByRole("main").getByRole("button", { name: m.space.create }).first().click();
    const dialog = page.getByRole("dialog", { name: m.space.create });
    await dialog.getByLabel(m.space.form.name).fill(`Ed ${locale}-${unique}`);
    await dialog.getByRole("button", { name: m.space.createDialog.submit }).click();
    await expect(page).toHaveURL(new RegExp(`/s/${spaceSlug}$`));
    const spacePath = new URL(page.url()).pathname;

    const aside = page.locator("aside");
    await aside.getByRole("button", { name: m.tree.newPage }).click();
    const input = aside.getByRole("textbox", { name: m.tree.renameLabel });
    await input.fill("Editor E2E");
    await input.press("Enter");
    await aside.getByRole("tree").getByRole("treeitem", { name: "Editor E2E" }).click();
    await expect(page).toHaveURL(new RegExp(`${spacePath}/p/`));
    const pagePath = new URL(page.url()).pathname;

    const editor = await waitForEditor(page, locale);
    await provide({ locale, m, editor, spacePath, pagePath, spaceSlug });
  },
});

export { expect };

/**
 * Signs a fresh internal user in a new browser context and gives them `role` in the Space, to check
 * what a viewer/editor can do. Needs the local Supabase of the run (`E2E_SUPABASE_*`).
 */
export async function contextAs(
  browser: Browser,
  spaceSlug: string,
  role: "viewer" | "editor",
  locale: E2ELocale = e2eLocale(),
): Promise<BrowserContext> {
  const env = supabaseEnv();
  if (!env) throw new Error("E2E_SUPABASE_* is not set");
  const random = Math.random().toString(36).slice(2, 8);
  const email = `e2e-${role}-${Date.now().toString(36)}-${random}@kb.test`;
  const user = { email, password: `e2e-${random}-${role}`, name: `E2E ${role}` };
  await allowEmail(env, email);
  await createUser(env, user);
  const cookies = await signInCookies(env, user, locale);
  await setProfileLocale(locale, email);

  const [space] = (await (
    await adminFetch(env, `/rest/v1/spaces?slug=eq.${encodeURIComponent(spaceSlug)}&select=id`)
  ).json()) as { id: string }[];
  const [profile] = (await (
    await adminFetch(env, `/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id`)
  ).json()) as { id: string }[];
  if (!space || !profile) throw new Error("Space or profile of the test user not found");
  await adminFetch(env, "/rest/v1/space_members", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ space_id: space.id, user_id: profile.id, role }),
  });

  const context = await browser.newContext({
    locale: locale === "en" ? "en-US" : "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  });
  await context.addCookies(cookies);
  return context;
}
