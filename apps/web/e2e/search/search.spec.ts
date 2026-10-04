import type viSearch from "@kb/i18n/messages/vi/search.json";
import type viSpace from "@kb/i18n/messages/vi/space.json";
import type { Page } from "@playwright/test";

import { e2eLocale, supabaseEnv } from "../support/env";
import { useLocale } from "../support/locale";
import { message } from "../support/messages";
import {
  addPage,
  contextFor,
  createSpace,
  createTestUser,
  editableEditor,
  openPage,
  uniqueSuffix,
  waitForSaved,
} from "../support/space";
import { expect, test } from "../support/test";

/**
 * T5.3, T7.1d — search typed without accents finds Vietnamese titles (quick switcher, Ctrl+K) and
 * body text (results page, once kb-collab has indexed it), driven by the keyboard; an internal
 * user outside the restricted Space gets no result for the same words. Creates its own data.
 */
const locale = e2eLocale();
const m = message<typeof viSearch>(locale, "search");
const space = message<typeof viSpace>(locale, "space");

test.skip(!process.env.E2E_STORAGE_STATE, "E2E_STORAGE_STATE is not set (see global-setup)");
test.use({ storageState: process.env.E2E_STORAGE_STATE });

/** Letters only: a word the search tokenizer keeps whole, unique to this test. */
const tag = () =>
  Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join(
    "",
  );

/**
 * Opens the quick switcher with Ctrl+K. The shortcut listener exists once the page hydrates: press
 * again until the box shows (only while it is closed — the shortcut toggles).
 */
async function openSwitcher(page: Page) {
  const box = page.getByRole("combobox", { name: m.placeholder });
  await expect(async () => {
    if (!(await box.isVisible())) await page.keyboard.press("Control+k");
    await expect(box).toBeFocused({ timeout: 1_000 });
  }).toPass();
  return box;
}

test("search without accents, from the switcher and the results page", async ({
  page,
  context,
  browser,
}, testInfo) => {
  await useLocale(context, locale);
  const titleTag = tag();
  const bodyTag = tag();
  const title = `Hướng dẫn đổi mực máy in ${titleTag}`;
  const slug = await createSpace(page, `Search ${uniqueSuffix(testInfo)}`);
  await addPage(page, title);
  const pagePath = await openPage(page, title);
  const editor = await editableEditor(page);
  await editor.click();
  await page.keyboard.type(`Quy trình bảo trì định kỳ ${bodyTag}`);
  await waitForSaved(page);

  // Title, accents left out, from the quick switcher; Enter opens the page.
  await page.goto("/");
  const box = await openSwitcher(page);
  await box.fill(`doi muc may in ${titleTag}`);
  const option = page.getByRole("option", { name: new RegExp(title) });
  await expect(option).toBeVisible();
  await box.press("Enter");
  await expect(page).toHaveURL(pagePath);

  // Body text, accents left out, on the results page ("see all" is the last row: ArrowUp wraps).
  // The body is indexed when kb-collab stores the document: poll the results page.
  const query = `bao tri dinh ky ${bodyTag}`;
  await openSwitcher(page);
  await box.fill(query);
  await box.press("ArrowUp");
  await expect(
    page.getByRole("option", { name: m.quickSwitcher.seeAll.replace("{query}", query) }),
  ).toHaveAttribute("aria-selected", "true");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=/);
  await expect(page.getByRole("heading", { level: 1, name: m.results.title })).toBeVisible();
  const hit = page.getByRole("link", { name: new RegExp(title) });
  await expect(async () => {
    await page.reload();
    await expect(hit).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(hit.locator("mark").first()).toBeVisible();
  await hit.click();
  await expect(page).toHaveURL(pagePath);

  // Someone without access to the restricted Space finds nothing.
  test.skip(!supabaseEnv(), "E2E_SUPABASE_* is not set (creates the outsider)");
  const outsider = await createTestUser("outsider");
  const outsiderContext = await contextFor(browser, outsider);
  const other = await outsiderContext.newPage();
  const titleQuery = `doi muc may in ${titleTag}`;
  await other.goto(`/search?q=${encodeURIComponent(titleQuery)}`);
  await expect(
    other.getByText(m.results.empty.title.replace("{query}", titleQuery), { exact: true }),
  ).toBeVisible();
  await other.goto(`/s/${slug}`);
  await expect(other.getByRole("heading", { name: space.notFound.title })).toBeVisible();
  await outsiderContext.close();
});
