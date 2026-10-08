// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(async (code: string) => {
    if (code.includes("bad")) throw new Error("Parse error on line 1");
    return true;
  }),
  render: vi.fn(async (id: string, code: string) => ({ svg: `<svg id="${id}">${code}</svg>` })),
}));
vi.mock("mermaid", () => ({ default: mermaid }));

import { createMermaidRenderer } from "./mermaid-renderer";

const labels = () => ({ diagram: "Diagram", error: "Broken", loading: "Loading" });

function container() {
  const el = document.createElement("div");
  el.className = "kb-mermaid";
  el.dataset.state = "idle";
  document.body.append(el);
  return el;
}

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  document.documentElement.className = "";
});

describe("createMermaidRenderer", () => {
  it("draws the diagram in strict mode with an accessible name", async () => {
    const el = container();
    createMermaidRenderer(labels)("graph TD; A---B", el);
    await vi.waitFor(() => expect(el.dataset.state).toBe("ok"));
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: "strict", theme: "default", startOnLoad: false }),
    );
    expect(el.querySelector("svg")?.textContent).toBe("graph TD; A---B");
    expect(el.getAttribute("role")).toBe("img");
    expect(el.getAttribute("aria-label")).toBe("Diagram");
    expect(el.hasAttribute("aria-busy")).toBe(false);
  });

  it("shows the translated error with the parser message", async () => {
    const el = container();
    createMermaidRenderer(labels)("bad code", el);
    await vi.waitFor(() => expect(el.dataset.state).toBe("error"));
    expect(el.querySelector("p")?.textContent).toBe("Broken");
    expect(el.querySelector("pre")?.textContent).toBe("Parse error on line 1");
    expect(el.getAttribute("role")).toBeNull();
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it("uses the dark theme in dark mode", async () => {
    document.documentElement.classList.add("dark");
    const el = container();
    createMermaidRenderer(labels)("graph TD", el);
    await vi.waitFor(() => expect(el.dataset.state).toBe("ok"));
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: "dark" }));
  });

  it("keeps only the latest of overlapping renders", async () => {
    const el = container();
    const render = createMermaidRenderer(labels);
    render("graph TD; old", el);
    render("graph TD; new", el);
    await vi.waitFor(() => expect(el.dataset.state).toBe("ok"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(el.querySelector("svg")?.textContent).toBe("graph TD; new");
  });

  it("empties the container for blank code", () => {
    const el = container();
    el.innerHTML = "<svg></svg>";
    createMermaidRenderer(labels)("  \n", el);
    expect(el.dataset.state).toBe("empty");
    expect(el.childElementCount).toBe(0);
    expect(mermaid.parse).not.toHaveBeenCalled();
  });
});
