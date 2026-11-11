// @vitest-environment happy-dom
import enCommon from "@kb/i18n/messages/en/common.json";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SidebarResizeHandle } from "./sidebar-resize-handle";
import { SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from "./sidebar-width";

afterEach(cleanup);

function renderHandle(width: number) {
  const onResize = vi.fn();
  const onCommit = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ common: enCommon }}>
      <SidebarResizeHandle width={width} onResize={onResize} onCommit={onCommit} />
    </NextIntlClientProvider>,
  );
  return { handle: screen.getByRole("separator", { name: "Resize sidebar" }), onResize, onCommit };
}

describe("SidebarResizeHandle", () => {
  it("exposes the current width to assistive tech", () => {
    const { handle } = renderHandle(300);
    expect(handle.getAttribute("aria-valuenow")).toBe("300");
    expect(handle.getAttribute("aria-valuemin")).toBe(String(SIDEBAR_WIDTH_MIN));
    expect(handle.getAttribute("aria-valuemax")).toBe(String(SIDEBAR_WIDTH_MAX));
  });

  it("resizes with the keyboard and persists the result", () => {
    const { handle, onResize, onCommit } = renderHandle(300);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onResize).toHaveBeenLastCalledWith(316);
    expect(onCommit).toHaveBeenLastCalledWith(316);
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(236);
    fireEvent.keyDown(handle, { key: "End" });
    expect(onCommit).toHaveBeenLastCalledWith(SIDEBAR_WIDTH_MAX);
  });

  it("resets to the default width on double-click", () => {
    const { handle, onCommit } = renderHandle(400);
    fireEvent.doubleClick(handle);
    expect(onCommit).toHaveBeenLastCalledWith(SIDEBAR_WIDTH_DEFAULT);
  });
});
