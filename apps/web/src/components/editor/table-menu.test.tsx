// @vitest-environment happy-dom
import { createExtensions } from "@kb/editor";
import { TableShortcuts } from "@kb/editor/ui";
import { CellSelection } from "@tiptap/pm/tables";
import enTable from "@kb/i18n/messages/en/table.json";
import viEditor from "@kb/i18n/messages/vi/editor.json";
import viTable from "@kb/i18n/messages/vi/table.json";
import { Editor, type JSONContent } from "@tiptap/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TableMenu } from "./table-menu";

const TABLE =
  "<table><tr><th><p>Mã</p></th><th><p>Tên</p></th></tr><tr><td><p>1</p></td><td><p>An</p></td></tr></table><p>after</p>";

const editors: Editor[] = [];

async function setup({
  locale = "vi",
  content = TABLE,
}: { locale?: "vi" | "en"; content?: string } = {}) {
  const container = document.createElement("div");
  container.className = "kb-editor";
  document.body.append(container);
  const element = document.createElement("div");
  container.append(element);
  const onMenuShortcut = vi.fn(() => true);
  const editor = new Editor({
    element,
    extensions: [...createExtensions(), TableShortcuts.configure({ onMenuShortcut })],
    content,
  });
  editors.push(editor);
  await new Promise((resolve) => editor.on("create", resolve));

  const messages = {
    editor: viEditor,
    table: locale === "vi" ? viTable : enTable,
  };
  const view = (focusRequest = 0) => (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Ho_Chi_Minh">
      <TableMenu editor={editor} pageTitle="Báo cáo" focusRequest={focusRequest} />
    </NextIntlClientProvider>
  );
  // React clears its container: render the toolbar next to the editor, like BlockEditor does.
  const host = document.createElement("div");
  container.append(host);
  const result = render(view(), { container: host });
  return { editor, rerender: (n: number) => result.rerender(view(n)) };
}

/** Puts the caret inside the text node `text`. */
function selectText(editor: Editor, text: string) {
  let pos = -1;
  editor.state.doc.descendants((node, p) => {
    if (pos < 0 && node.isText && node.text === text) pos = p + 1;
  });
  act(() => {
    editor.commands.setTextSelection(pos);
  });
}

/** Selects the cells from the one holding `from` to the one holding `to` (a CellSelection). */
function selectCells(editor: Editor, from: string, to: string) {
  const cellPos = (text: string) => {
    let found = -1;
    editor.state.doc.descendants((node, p) => {
      if (found < 0 && node.type.spec.tableRole === "cell" && node.textContent === text) found = p;
    });
    return found;
  };
  act(() => {
    const { doc } = editor.state;
    editor.view.dispatch(
      editor.state.tr.setSelection(CellSelection.create(doc, cellPos(from), cellPos(to))),
    );
  });
}

/** shadcn's dropdown ignores a reopen during its ~150 ms close animation. */
const waitForMenuClosed = () => vi.waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

const rows = (editor: Editor) => {
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "tableRow") count++;
  });
  return count;
};

const columns = (editor: Editor) => {
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (count === 0 && node.type.name === "tableRow") count = node.childCount;
  });
  return count;
};

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(cb, 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});

afterEach(() => {
  cleanup();
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TableMenu", () => {
  it("shows only while the selection is inside a table", async () => {
    const { editor } = await setup();
    selectText(editor, "after");
    expect(screen.queryByRole("toolbar")).toBeNull();

    selectText(editor, "An");
    expect(screen.getByRole("toolbar", { name: "Công cụ bảng" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tuỳ chọn bảng" })).toBeTruthy();
  });

  it("translates labels (en)", async () => {
    const { editor } = await setup({ locale: "en" });
    selectText(editor, "An");
    expect(screen.getByRole("toolbar", { name: "Table tools" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Insert column right" })).toBeTruthy();
  });

  it("runs quick actions: insert row below, insert column right, delete table", async () => {
    const user = userEvent.setup();
    const { editor } = await setup();
    selectText(editor, "An");
    await user.click(screen.getByRole("button", { name: "Chèn hàng phía dưới" }));
    expect(rows(editor)).toBe(3);
    await user.click(screen.getByRole("button", { name: "Chèn cột bên phải" }));
    expect(columns(editor)).toBe(3);

    await user.click(screen.getByRole("button", { name: "Xoá bảng" }));
    expect(rows(editor)).toBe(0);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("lists every action in the menu, disabling those that cannot run", async () => {
    const user = userEvent.setup();
    const { editor } = await setup({ content: "<table><tr><td><p>x</p></td></tr></table>" });
    selectText(editor, "x");
    screen.getByRole("button", { name: "Tuỳ chọn bảng" }).focus();
    await user.keyboard("{Enter}");

    const menu = await screen.findByRole("menu");
    // Accessible names may end with the shortcut ("Chèn hàng phía dưới Ctrl+Enter").
    const item = (name: string) => screen.getByRole("menuitem", { name: new RegExp(`^${name}`) });
    expect(menu).toBeTruthy();
    for (const name of [
      "Chèn hàng phía trên",
      "Chèn hàng phía dưới",
      "Chèn cột bên trái",
      "Chèn cột bên phải",
      "Xuất CSV",
    ]) {
      expect(item(name).getAttribute("aria-disabled")).toBeNull();
    }
    // One row and one column: delete the table instead.
    expect(item("Xoá hàng").getAttribute("aria-disabled")).toBe("true");
    expect(item("Xoá cột").getAttribute("aria-disabled")).toBe("true");
    const headerRow = screen.getByRole("menuitemcheckbox", { name: "Hàng tiêu đề" });
    expect(headerRow.getAttribute("aria-checked")).toBe("false");

    await user.click(headerRow);
    const json: JSONContent = editor.getJSON();
    expect(json.content?.[0]?.content?.[0]?.content?.[0]?.type).toBe("tableHeader");
  });

  it("merges a cell selection and splits it back from the menu", async () => {
    const user = userEvent.setup();
    const { editor } = await setup();
    selectCells(editor, "1", "An");
    screen.getByRole("button", { name: "Tuỳ chọn bảng" }).focus();
    await user.keyboard("{Enter}");
    const merge = await screen.findByRole("menuitem", { name: "Gộp ô" });
    expect(screen.getByRole("menuitem", { name: "Tách ô" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
    await user.click(merge);
    const merged = editor.state.doc.firstChild!.child(1).firstChild!;
    expect(merged.attrs).toMatchObject({ colspan: 2, rowspan: 1 });

    await waitForMenuClosed();
    selectText(editor, "1");
    screen.getByRole("button", { name: "Tuỳ chọn bảng" }).focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("menuitem", { name: "Tách ô" }));
    expect(editor.state.doc.firstChild!.child(1).childCount).toBe(2);
  });

  it("colours the selected cells from the colour submenu with the keyboard (en)", async () => {
    const user = userEvent.setup();
    const { editor } = await setup({ locale: "en" });
    selectCells(editor, "1", "An");
    screen.getByRole("button", { name: "Table options" }).focus();
    await user.keyboard("{Enter}");
    const trigger = await screen.findByRole("menuitem", { name: "Cell color" });
    trigger.focus();
    await user.keyboard("{ArrowRight}");
    const blue = await screen.findByRole("menuitemradio", { name: "Blue" });
    const none = screen.getByRole("menuitemradio", { name: "No color" });
    expect(none.getAttribute("aria-checked")).toBe("true");
    blue.focus();
    await user.keyboard("{Enter}");
    const row = editor.state.doc.firstChild!.child(1);
    expect([row.child(0).attrs.backgroundColor, row.child(1).attrs.backgroundColor]).toEqual([
      "blue",
      "blue",
    ]);
    // Header cells are untouched; the cell renders the code, never a colour value.
    expect(editor.state.doc.firstChild!.child(0).child(0).attrs.backgroundColor).toBeNull();
    expect(editor.view.dom.querySelector('td[data-background-color="blue"]')).toBeTruthy();
  });

  it("downloads the table as CSV named after the page title", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn((_blob: Blob) => "blob:csv");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this);
    });

    const { editor } = await setup();
    selectText(editor, "An");
    await user.click(screen.getByRole("button", { name: "Xuất CSV" }));

    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.download).toMatch(/^Bao cao \d{4}-\d{2}-\d{2}\.csv$/);
    const blob = createObjectURL.mock.calls[0]![0];
    expect(blob.type).toBe("text/csv;charset=utf-8");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM for Excel
    expect(new TextDecoder().decode(bytes.slice(3))).toBe("Mã,Tên\r\n1,An");
  });

  it("takes focus on request (Alt-F10), moves with arrow keys and returns to the editor on Escape", async () => {
    const user = userEvent.setup();
    const { editor, rerender } = await setup();
    selectText(editor, "An");
    rerender(1);
    const trigger = screen.getByRole("button", { name: "Tuỳ chọn bảng" });
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));

    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Chèn hàng phía dưới" }),
    );
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Xoá bảng" }));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(trigger);
    expect(trigger.tabIndex).toBe(0);

    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(document.activeElement).toBe(editor.view.dom));
  });
});
