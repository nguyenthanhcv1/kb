// @vitest-environment happy-dom
import enTree from "@kb/i18n/messages/en/tree.json";
import { act, cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PageStickyHeader, useScrolledPast } from "./page-sticky-header";

type Callback = (entries: Partial<IntersectionObserverEntry>[]) => void;
let observed: Callback | null = null;

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: Callback) {
        observed = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  observed = null;
});

function Harness({ enabled = true }: { enabled?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const past = useScrolledPast(ref, enabled);
  return (
    <NextIntlClientProvider locale="en" messages={{ tree: enTree }}>
      <header ref={ref}>Header</header>
      <PageStickyHeader
        visible={past}
        icon="🚀"
        title="4. Projects"
        actions={<button type="button">Edit</button>}
      />
    </NextIntlClientProvider>
  );
}

const scroll = (isIntersecting: boolean, top: number) =>
  act(() => observed?.([{ isIntersecting, boundingClientRect: { top } as DOMRectReadOnly }]));

describe("PageStickyHeader", () => {
  it("appears with the title and actions once the header scrolled under the top bar", () => {
    render(<Harness />);
    const bar = screen.getByTestId("page-sticky-header");
    expect(bar.getAttribute("data-visible")).toBe("false");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();

    scroll(false, -120);
    expect(bar.getAttribute("data-visible")).toBe("true");
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /4\. Projects/ }).getAttribute("title")).toBe(
      enTree.page.sticky.backToTop,
    );

    scroll(true, 80);
    expect(bar.getAttribute("data-visible")).toBe("false");
  });

  it("stays hidden while the header is below the viewport or when disabled", () => {
    render(<Harness />);
    scroll(false, 2000);
    expect(screen.getByTestId("page-sticky-header").getAttribute("data-visible")).toBe("false");
    cleanup();
    observed = null;

    render(<Harness enabled={false} />);
    expect(observed).toBeNull();
  });
});
