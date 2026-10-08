import type viEditor from "@kb/i18n/messages/vi/editor.json";
import type viSpace from "@kb/i18n/messages/vi/space.json";
import type viTree from "@kb/i18n/messages/vi/tree.json";
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";

import { adminFetch, allowEmail, createUser, signInCookies } from "./auth";
import { baseUrl, type E2ELocale, e2eLocale, supabaseEnv } from "./env";
import { message } from "./messages";
import { expect } from "./test";
import { setProfileLocale } from "./users";

/**
 * Building blocks of the feature flows (T7.1d): every test creates its own Space and pages through
 * the UI as the worker's user, and extra users (viewer, outsider) through the Supabase admin API,
 * so no spec depends on prepared data (`E2E_PAGE_PATH`…) or on another spec.
 */
type Messages = { editor: typeof viEditor; space: typeof viSpace; tree: typeof viTree };

const load = (locale: E2ELocale): Messages => ({
  editor: message(locale, "editor"),
  space: message(locale, "space"),
  tree: message(locale, "tree"),
});

/** Suffix unique per test run, worker and retry (names and slugs must not collide). */
export function uniqueSuffix(testInfo: TestInfo): string {
  return `${e2eLocale()}-${Date.now().toString(36)}${testInfo.parallelIndex}${testInfo.retry}`;
}

/** Creates a Space from the home page; returns its slug (derived from the name). */
export async function createSpace(page: Page, name: string): Promise<string> {
  const m = load(e2eLocale());
  await page.goto("/");
  await page.getByRole("main").getByRole("button", { name: m.space.create }).first().click();
  const dialog = page.getByRole("dialog", { name: m.space.create });
  await dialog.getByLabel(m.space.form.name).fill(name);
  const slug = await dialog.getByLabel(m.space.form.slug).inputValue();
  await dialog.getByRole("button", { name: m.space.createDialog.submit }).click();
  await expect(page).toHaveURL(`/s/${slug}`);
  return slug;
}

export const sidebarTree = (page: Page) => page.locator("aside").getByRole("tree");

/** `/s/<space>/p/<slug>-<shortId>`: a page URL that carries the slug of its title. */
const CANONICAL_PAGE = /\/s\/[^/]+\/p\/[^/]+-[A-Za-z0-9]{8}$/;

/**
 * Adds a top-level page from the sidebar of the current Space. The title shows at once
 * (optimistic); waits until the rename is stored: after a reload the row links to the slugged URL
 * (the sidebar only gets the slug from the server, and its live update is not reliable yet).
 */
export async function addPage(page: Page, title: string) {
  const m = load(e2eLocale());
  const aside = page.locator("aside");
  await aside.getByRole("button", { name: m.tree.newPage }).click();
  const input = aside.getByRole("textbox", { name: m.tree.renameLabel });
  await input.fill(title);
  await input.press("Enter");
  const row = sidebarTree(page).getByRole("treeitem", { name: title });
  await expect(row).toBeVisible();
  await expect(async () => {
    const href = await row.getAttribute("href", { timeout: 2_000 });
    if (href && CANONICAL_PAGE.test(href)) return;
    await page.reload();
    throw new Error(`"${title}" is not stored yet (${href})`);
  }).toPass();
}

/** Opens a page from the sidebar; returns its path (`/s/<space>/p/<slug>-<shortId>`). */
export async function openPage(page: Page, title: string): Promise<string> {
  await sidebarTree(page).getByRole("treeitem", { name: title }).click();
  await expect(page).toHaveURL(CANONICAL_PAGE);
  return new URL(page.url()).pathname;
}

/**
 * Switches the open page to editing ("Edit"; a new, empty page already opens that way). Retried:
 * a click before hydration does nothing.
 */
export async function startEditing(page: Page) {
  const m = load(e2eLocale());
  const edit = page.getByRole("button", { name: m.tree.page.mode.editLabel });
  const done = page.getByRole("button", { name: m.tree.page.mode.doneLabel });
  await expect(async () => {
    if (await edit.isVisible()) await edit.click();
    await expect(done).toBeVisible({ timeout: 1_000 });
  }).toPass();
}

/** The page editor once switched to editing, the collaboration session connected and saved. */
export async function editableEditor(page: Page) {
  const m = load(e2eLocale());
  await startEditing(page);
  const editor = page.getByRole("textbox", { name: m.editor.content.label });
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await waitForSaved(page);
  return editor;
}

/**
 * Reloads `page` until `check` passes. Readers (viewers) get the server-rendered `content_json`,
 * not the live document: kb-collab writes it about 2 s (debounce) after the editor shows "Saved",
 * so a reader opening the page right after an edit can see the previous content.
 */
export async function untilStored(page: Page, check: () => Promise<void>) {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout: 30_000 });
}

/** Waits until everything typed is stored by kb-collab. */
export async function waitForSaved(page: Page) {
  await expect(page.locator('[data-status="saved"]')).toBeVisible();
}

export type TestUser = { email: string; password: string; name: string };

/**
 * Creates an internal user allowed to sign in (allowlist), with `locale` in their profile and,
 * when `space` is given, `role` in that Space. Needs the local Supabase of the run.
 */
export async function createTestUser(
  label: string,
  options: { locale?: E2ELocale; space?: string; role?: "viewer" | "editor" | "admin" } = {},
): Promise<TestUser> {
  const env = supabaseEnv();
  if (!env) throw new Error("E2E_SUPABASE_* is not set");
  const random = Math.random().toString(36).slice(2, 8);
  const user = {
    email: `e2e-${label}-${Date.now().toString(36)}-${random}@kb.test`,
    password: `e2e-${random}-${label}`,
    name: `E2E ${label} ${random}`,
  };
  await allowEmail(env, user.email);
  await createUser(env, user);
  await setProfileLocale(options.locale ?? e2eLocale(), user.email);

  if (options.space) {
    const [space] = (await (
      await adminFetch(
        env,
        `/rest/v1/spaces?slug=eq.${encodeURIComponent(options.space)}&select=id`,
      )
    ).json()) as { id: string }[];
    const [profile] = (await (
      await adminFetch(
        env,
        `/rest/v1/profiles?email=eq.${encodeURIComponent(user.email)}&select=id`,
      )
    ).json()) as { id: string }[];
    if (!space || !profile) throw new Error(`Space ${options.space} or ${user.email} not found`);
    await adminFetch(env, "/rest/v1/space_members", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        space_id: space.id,
        user_id: profile.id,
        role: options.role ?? "viewer",
      }),
    });
  }
  return user;
}

/** Signs `user` in: adds fresh session cookies (and the locale cookie) to `context`. */
export async function signIn(context: BrowserContext, user: TestUser, locale = e2eLocale()) {
  const env = supabaseEnv();
  if (!env) throw new Error("E2E_SUPABASE_* is not set");
  await context.addCookies(await signInCookies(env, user, locale));
}

/** A new browser context signed in as `user`, with the run's browser locale and time zone. */
export async function contextFor(browser: Browser, user: TestUser): Promise<BrowserContext> {
  const locale = e2eLocale();
  const context = await browser.newContext({
    baseURL: baseUrl(),
    locale: locale === "en" ? "en-US" : "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  });
  await signIn(context, user, locale);
  return context;
}
