import { expect, newLine, test } from "../support/editor";

/**
 * T3.6b / T7.1c — upload images and files in the editor: "File" from "/", pasting an image, and the
 * guarantee that nothing is embedded as base64. Labels come from the message files; runs in the
 * language of the run (`E2E_LOCALE`). Each test creates its own Space and page (support/editor).
 */
test.skip(
  !process.env.E2E_STORAGE_STATE,
  "E2E_STORAGE_STATE is not set (signed-in internal user, see T7.1b)",
);
// The worker's signed-in user (playwright.config.ts points it at e2e-w<N>@kb.test).
test.use({ storageState: process.env.E2E_STORAGE_STATE });

// 1×1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test("pasting an image uploads it and stores a reference, not base64", async ({ page, doc }) => {
  const { editor } = doc;
  await newLine(page, editor);
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

test("the File slash item uploads a document and inserts a download link", async ({
  page,
  doc,
}) => {
  const {
    editor,
    m: { editor: m },
  } = doc;
  await newLine(page, editor);
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

test("a type that is not allowed is refused with a message", async ({ page, doc }) => {
  const {
    editor,
    m: { editor: m },
  } = doc;
  await newLine(page, editor);
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
  // Other live regions (autosave, drag-and-drop) share the role: pick the upload message.
  await expect(page.getByRole("status").filter({ hasText: "run.exe" })).toBeVisible();
  await expect(editor.getByRole("link", { name: "run.exe" })).toHaveCount(0);
});
