// @vitest-environment happy-dom
import { getEditorSchema } from "@kb/editor";
import viEditor from "@kb/i18n/messages/vi/editor.json";
import viErrors from "@kb/i18n/messages/vi/errors.json";
import viTable from "@kb/i18n/messages/vi/table.json";
import { type Editor, Extension, type JSONContent } from "@tiptap/core";
import Collaboration, { isChangeOrigin } from "@tiptap/extension-collaboration";
import { prosemirrorToYXmlFragment } from "@tiptap/y-tiptap";
import { act, cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

vi.mock("@/server/attachments/actions", () => ({ createAttachmentUpload: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

import { BlockEditor } from "./block-editor";

const schema = getEditorSchema();
const FROM_SERVER = "server";

afterEach(cleanup);

const tick = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

/**
 * Opens `stored` the way CollabEditor does once synced (BlockEditor bound to a Y.Doc holding the
 * server state, re-rendered as the connection status changes) and records every Yjs update the
 * editor itself makes — each one would be sent to kb-collab and stored.
 */
async function openPage(stored: JSONContent | null, editable = true) {
  const server = new Y.Doc();
  if (stored) {
    prosemirrorToYXmlFragment(schema.nodeFromJSON(stored), server.getXmlFragment("default"));
  }
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(server), FROM_SERVER);
  const localUpdates: Uint8Array[] = [];
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== FROM_SERVER) localUpdates.push(update);
  });
  let editor: Editor | null = null;
  const view = () => (
    <NextIntlClientProvider
      locale="vi"
      messages={{ editor: viEditor, table: viTable, errors: viErrors }}
      timeZone="Asia/Ho_Chi_Minh"
    >
      <BlockEditor
        editable={editable}
        extensions={[
          Collaboration.configure({ document: doc }),
          Extension.create({
            name: "testHook",
            onCreate() {
              editor = this.editor;
            },
          }),
        ]}
        extensionOptions={{
          undoRedo: false,
          uniqueId: { filterTransaction: (tr) => !isChangeOrigin(tr) },
        }}
        title="t"
        pageId="00000000-0000-0000-0000-000000000001"
      />
    </NextIntlClientProvider>
  );
  const rendered = render(view());
  await tick(100);
  for (let i = 0; i < 3; i++) {
    rendered.rerender(view());
    await tick(20);
  }
  return { localUpdates, doc, editor: () => editor };
}

const paragraph = (id: string | null, text: string): JSONContent => ({
  type: "paragraph",
  attrs: { id },
  content: [{ type: "text", text }],
});
const cell = (id: string): JSONContent => ({
  type: "tableCell",
  attrs: { id },
  content: [paragraph(`${id}p`, "c")],
});
const tableDoc: JSONContent = {
  type: "doc",
  content: [
    {
      type: "table",
      attrs: { id: "t" },
      content: [
        { type: "tableRow", attrs: { id: "r1" }, content: [cell("c1"), cell("c2")] },
        { type: "tableRow", attrs: { id: "r2" }, content: [cell("c3"), cell("c4")] },
      ],
    },
  ],
};

const pages: Record<string, JSONContent | null> = {
  "a new, empty page": null,
  "blocks with IDs": { type: "doc", content: [paragraph("a", "x"), paragraph("b", "y")] },
  "blocks without IDs": { type: "doc", content: [paragraph(null, "x")] },
  "a page ending with a table": tableDoc,
  "a page ending with a mermaid code block": {
    type: "doc",
    content: [
      {
        type: "codeBlock",
        attrs: { id: "m", language: "mermaid" },
        content: [{ type: "text", text: "graph TD; A-->B" }],
      },
    ],
  },
};

describe("opening a page does not change it", () => {
  for (const [name, stored] of Object.entries(pages)) {
    it(`${name} (editor)`, async () => {
      const { localUpdates } = await openPage(stored);
      expect(localUpdates).toHaveLength(0);
    });
    it(`${name} (viewer)`, async () => {
      const { localUpdates } = await openPage(stored, false);
      expect(localUpdates).toHaveLength(0);
    });
  }
});

describe("editing still normalizes the page", () => {
  it("typing in a page ending with a table adds the trailing paragraph", async () => {
    const { doc, editor } = await openPage(tableDoc);
    act(() => {
      editor()!.chain().setTextSelection(4).insertContent("!").run();
    });
    const blocks = doc.getXmlFragment("default").toArray() as Y.XmlElement[];
    expect(blocks.map((block) => block.nodeName)).toEqual(["table", "paragraph"]);
    expect(blocks[1]!.getAttribute("id")).toEqual(expect.any(String));
  });

  it("typing in a new page stores the paragraph with a block ID", async () => {
    const { doc, editor } = await openPage(null);
    act(() => {
      editor()!.chain().insertContent("Hello").run();
    });
    const blocks = doc.getXmlFragment("default").toArray() as Y.XmlElement[];
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.getAttribute("id")).toEqual(expect.any(String));
  });
});
