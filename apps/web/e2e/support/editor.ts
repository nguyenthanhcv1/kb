import type viEditor from "@kb/i18n/messages/vi/editor.json";
import type viSpace from "@kb/i18n/messages/vi/space.json";
import type viTable from "@kb/i18n/messages/vi/table.json";
import type viTree from "@kb/i18n/messages/vi/tree.json";
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";

import { type E2ELocale, e2eLocale } from "./env";
import { useLocale as setLocale } from "./locale";
import { message } from "./messages";
import {
  addPage,
  contextFor,
  createSpace,
  createTestUser,
  editableEditor,
  openPage,
  uniqueSuffix,
  waitForSaved,
} from "./space";
import { expect, test as base } from "./test";

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

export { waitForSaved };

/**
 * Waits until the editor's selection follows a click. ProseMirror reads the DOM selection a moment
 * after the click (it applies typing either way); a shortcut pressed before that acts on the
 * previous caret. A person is never that fast, a test is.
 */
export async function waitForCaret(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        type View = {
          state: { selection: { head: number } };
          posAtDOM(node: Node, offset: number): number;
        };
        const dom = document.querySelector<HTMLElement & { editor?: { view: View } }>(
          ".ProseMirror-focused",
        );
        const selection = window.getSelection();
        const view = dom?.editor?.view;
        if (!view || !selection?.focusNode) return false;
        return (
          view.posAtDOM(selection.focusNode, selection.focusOffset) === view.state.selection.head
        );
      }),
    )
    .toBe(true);
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
    const spaceSlug = await createSpace(page, `Ed ${uniqueSuffix(testInfo)}`);
    const spacePath = `/s/${spaceSlug}`;
    await addPage(page, "Editor E2E");
    const pagePath = await openPage(page, "Editor E2E");

    const editor = await editableEditor(page);
    await provide({ locale, m, editor, spacePath, pagePath, spaceSlug });
  },
});

export { expect };

/** DIAGNOSTIC (temporary): runs `check`; on failure reports what the viewer page shows. */
export async function diagnoseViewer(viewer: Page, check: () => Promise<void>) {
  try {
    await check();
  } catch (error) {
    const info = await viewer.evaluate(() => ({
      url: location.pathname,
      lang: document.documentElement.lang,
      boxes: [...document.querySelectorAll('[role="textbox"]')].map((e) => e.getAttribute("aria-label")),
      editors: document.querySelectorAll(".ProseMirror").length,
      status: document.querySelector("[data-status]")?.getAttribute("data-status"),
      text: document.querySelector("main")?.textContent?.slice(0, 200),
    }));
    throw new Error(`DIAG viewer page ${JSON.stringify(info)}`, { cause: error });
  }
}

/**
 * Opens the test page in another user's page the way a person does: the Space first (proves
 * access), then the page from the sidebar.
 */
export async function openDocAs(viewer: Page, doc: EditorFixture) {
  await viewer.goto(doc.spacePath);
  const row = viewer.locator("aside").getByRole("treeitem", { name: "Editor E2E" });
  await expect(row).toBeVisible();
  await row.click();
  await expect(viewer).toHaveURL(doc.pagePath);
}

/**
 * Signs a fresh internal user in a new browser context (with the run's base URL) and gives them
 * `role` in the Space, to check what a viewer/editor can do. Needs `E2E_SUPABASE_*`.
 */
export async function contextAs(
  browser: Browser,
  spaceSlug: string,
  role: "viewer" | "editor",
  locale: E2ELocale = e2eLocale(),
): Promise<BrowserContext> {
  const user = await createTestUser(role, { locale, space: spaceSlug, role });
  return contextFor(browser, user);
}
