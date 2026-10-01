import { createRequire } from "node:module";

import type viEditor from "@kb/i18n/messages/vi/editor.json";
import { expect, type Page, test } from "@playwright/test";

/**
 * T3.6b — upload images and files in the editor: "File" from "/", pasting an image, and the
 * guarantee that nothing is embedded as base64. Labels come from the message files (vi and en).
 *
 * Needs a page showing the block editor with edit rights (`E2E_EDITOR_PATH`, like the table spec);
 * skipped without it.
 */
const EDITOR_PATH = process.env.E2E_EDITOR_PATH;
const BASE_URL = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000").origin;

const require = createRequire(import.meta.url);
const messages: Record<"vi" | "en", { editor: typeof viEditor }> = {
  vi: { editor: require("@kb/i18n/messages/vi/editor.json") },
  en: { editor: require("@kb/i18n/messages/en/editor.json") },
};

test.skip(!EDITOR_PATH, "E2E_EDITOR_PATH is not set (page with the editor, see T3.5/T7.1b)");

// 1×1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function openEditor(page: Page, locale: "vi" | "en") {
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: BASE_URL }]);
  await page.goto(EDITOR_PATH!);
  const editor = page.getByRole("textbox", { name: messages[locale].editor.content.label });
  await expect(editor).toBeVisible();
  await editor.locator(":scope > *").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  return editor;
}

for (const locale of ["vi", "en"] as const) {
  test.describe(`editor upload (${locale})`, () => {
    const m = messages[locale].editor;

    test("pasting an image uploads it and stores a reference, not base64", async ({ page }) => {
      const editor = await openEditor(page, locale);
      await editor.evaluate((node, base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const data = new DataTransfer();
        data.items.add(new File([bytes], "paste.png", { type: "image/png" }));
        node.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
        );
      }, PNG.toString("base64"));

      const image = editor.locator("img").last();
      await expect(image).toHaveAttribute("src", /^\/api\/attachments\/[0-9a-f-]{36}$/);
      expect(await editor.innerHTML()).not.toContain("data:image");
    });

    test("the File slash item uploads a document and inserts a download link", async ({ page }) => {
      const editor = await openEditor(page, locale);
      await page.keyboard.type("/file");
      const chooser = page.waitForEvent("filechooser");
      await page
        .getByRole("option", { name: new RegExp(m.slash.items.file.title) })
        .first()
        .click();
      await (
        await chooser
      ).setFiles({
        name: "bao-cao.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("hello"),
      });
      await expect(editor.getByRole("link", { name: "bao-cao.txt" })).toHaveAttribute(
        "href",
        /^\/api\/attachments\/[0-9a-f-]{36}\?download=1$/,
      );
    });

    test("a type that is not allowed is refused with a message", async ({ page }) => {
      const editor = await openEditor(page, locale);
      await page.keyboard.type("/file");
      const chooser = page.waitForEvent("filechooser");
      await page
        .getByRole("option", { name: new RegExp(m.slash.items.file.title) })
        .first()
        .click();
      await (
        await chooser
      ).setFiles({
        name: "run.exe",
        mimeType: "application/x-msdownload",
        buffer: Buffer.from("MZ"),
      });
      await expect(page.getByRole("status")).toContainText("run.exe");
      await expect(editor.getByRole("link", { name: "run.exe" })).toHaveCount(0);
    });
  });
}
