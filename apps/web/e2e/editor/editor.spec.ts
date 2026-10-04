import { supabaseEnv } from "../support/env";
import { contextAs, expect, newLine, test, waitForSaved } from "../support/editor";
import { editableEditor } from "../support/space";

/**
 * T7.1c — editor flows (docs/PLAN.md §8): blocks from the "/" menu, formatting from the bubble
 * menu and shortcuts, content kept after a reload (it goes through kb-collab), a viewer cannot
 * edit. Runs in the language of the run (`E2E_LOCALE=vi|en`, see playwright.config.ts); every
 * label is read from the message files. Each test creates its own Space and page (support/editor).
 */
test.skip(
  !process.env.E2E_STORAGE_STATE,
  "E2E_STORAGE_STATE is not set (signed-in internal user, see T7.1b)",
);
// The worker's signed-in user (playwright.config.ts points it at e2e-w<N>@kb.test).
test.use({ storageState: process.env.E2E_STORAGE_STATE });

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("insert every kind of block from the slash menu", async ({ page, doc }) => {
  const { editor, m } = doc;
  const items = m.editor.slash.items;
  const insert = async (title: string, { onNewLine = true } = {}) => {
    if (onNewLine) await newLine(page, editor);
    await page.keyboard.type("/");
    await expect(page.getByRole("listbox", { name: m.editor.slash.label })).toBeVisible();
    await page
      .getByRole("option", { name: new RegExp(escape(title)) })
      .first()
      .click();
  };

  await insert(items.heading1.title);
  await page.keyboard.type("Tieu de");
  await expect(editor.locator("h1")).toHaveText("Tieu de");

  await insert(items.bulletList.title);
  await page.keyboard.type("Mot");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Hai");
  await expect(editor.locator("ul:not([data-type='taskList']) > li")).toHaveText(["Mot", "Hai"]);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter"); // an empty item leaves the list

  await insert(items.orderedList.title);
  await page.keyboard.type("Buoc 1");
  await expect(editor.locator("ol > li")).toHaveText(["Buoc 1"]);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");

  await insert(items.taskList.title);
  await page.keyboard.type("Viec can lam");
  const task = editor.locator("ul[data-type='taskList'] > li");
  // The item also holds the checkbox label, so match the text, not the whole content.
  await expect(task).toContainText("Viec can lam");
  await task.getByRole("checkbox").check();
  await expect(task).toHaveAttribute("data-checked", "true");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");

  await insert(items.blockquote.title);
  await page.keyboard.type("Trich dan");
  await expect(editor.locator("blockquote")).toHaveText("Trich dan");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");

  await insert(items.callout.info.title);
  await page.keyboard.type("Ghi chu");
  await expect(editor.locator("div[data-type='callout']")).toContainText("Ghi chu");

  await insert(items.codeBlock.title);
  await page.keyboard.type("const a = 1;");
  await expect(editor.locator("pre code")).toHaveText("const a = 1;");

  // Enter inside a code block adds a code line, not a paragraph: Mod+Enter leaves the block.
  await page.keyboard.press("ControlOrMeta+Enter");
  await insert(items.divider.title, { onNewLine: false });
  await expect(editor.locator("hr")).toHaveCount(1);
});

test("filter the slash menu by typing, Escape closes it, an unknown word shows the empty state", async ({
  page,
  doc,
}) => {
  const { editor, m } = doc;
  await newLine(page, editor);
  await page.keyboard.type("/");
  const list = page.getByRole("listbox", { name: m.editor.slash.label });
  await expect(list).toBeVisible();
  await page.keyboard.type("zzzzqqq");
  await expect(list.getByRole("option")).toHaveCount(0);
  await expect(page.getByText(m.editor.slash.empty)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
});

test("bubble menu and shortcuts format the selected text", async ({ page, doc }) => {
  const { editor, m } = doc;
  await newLine(page, editor);
  await page.keyboard.type("dam nghieng gach");

  // Select the whole line, then format from the bubble menu.
  await page.keyboard.press("Shift+Home");
  const bubble = page.getByRole("toolbar", { name: m.editor.bubble.label });
  await expect(bubble).toBeVisible();
  await bubble.getByRole("button", { name: m.editor.bubble.bold }).click();
  await expect(editor.locator("strong")).toHaveText("dam nghieng gach");
  await expect(bubble.getByRole("button", { name: m.editor.bubble.bold })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Keyboard shortcuts on the same selection.
  await editor.locator("strong").click({ clickCount: 3 });
  await page.keyboard.press("ControlOrMeta+i");
  await expect(editor.locator("em")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+Shift+s");
  await expect(editor.locator("s")).toHaveCount(1);

  // Turn the block into a heading from the bubble menu.
  await bubble.getByRole("button", { name: m.editor.bubble.blockType }).click();
  await page
    .getByRole("menuitemradio", { name: new RegExp(escape(m.editor.slash.items.heading2.title)) })
    .click();
  await expect(editor.locator("h2")).toContainText("dam nghieng gach");
});

test("markdown shortcuts, undo and redo", async ({ page, doc }) => {
  const { editor } = doc;
  await newLine(page, editor);
  await page.keyboard.type("## Muc hai");
  await expect(editor.locator("h2")).toHaveText("Muc hai");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- a");
  await expect(editor.locator("ul > li")).toHaveText("a");

  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(editor).toContainText("Muc hai");
});

test("typed content is saved and still there after a reload", async ({ page, doc }) => {
  const { editor } = doc;
  const text = `Noi dung ${Date.now().toString(36)}`;
  await newLine(page, editor);
  await page.keyboard.type("/");
  await page
    .getByRole("option", { name: new RegExp(escape(doc.m.editor.slash.items.heading1.title)) })
    .first()
    .click();
  await page.keyboard.type(text);
  await waitForSaved(page);

  await page.reload();
  const reloaded = await editableEditor(page);
  await expect(reloaded.locator("h1")).toHaveText(text);
});

test("a viewer sees the content but cannot edit", async ({ page, doc, browser }) => {
  test.skip(!supabaseEnv(), "E2E_SUPABASE_* is not set (needed to create the viewer)");
  const text = `Chi doc ${Date.now().toString(36)}`;
  await newLine(page, doc.editor);
  // One edit, stored before the viewer opens the page.
  await page.keyboard.insertText(text);
  await expect(doc.editor).toContainText(text);
  await waitForSaved(page);

  const context = await contextAs(browser, doc.spaceSlug, "viewer", doc.locale);
  try {
    const viewer = await context.newPage();
    await viewer.goto(doc.pagePath);
    const readOnly = viewer.getByRole("textbox", { name: doc.m.editor.content.label });
    await expect(readOnly).toContainText(text);
    await expect(readOnly).toHaveAttribute("contenteditable", "false");

    // Typing does nothing: the text is unchanged and no slash menu opens.
    await readOnly.click();
    await viewer.keyboard.type("/zzz");
    await expect(viewer.getByRole("listbox", { name: doc.m.editor.slash.label })).toHaveCount(0);
    await expect(readOnly).not.toContainText("zzz");
  } finally {
    await context.close();
  }

  // The author's editor is untouched.
  await expect(doc.editor).not.toContainText("zzz");
});
