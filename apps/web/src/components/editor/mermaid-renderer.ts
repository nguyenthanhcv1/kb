import { MERMAID_PREVIEW_CLASS, type MermaidRender } from "@kb/editor/ui";
import type MermaidLibrary from "mermaid";

type Mermaid = typeof MermaidLibrary;

export type MermaidLabels = {
  /** Accessible name of a drawn diagram. */
  diagram: string;
  /** Shown above the parser message when the code has an error. */
  error: string;
  loading: string;
};

let library: Promise<Mermaid> | null = null;

/** Mermaid is large: loaded only when a page actually has a diagram. */
function loadMermaid(): Promise<Mermaid> {
  library ??= import("mermaid").then((module) => module.default);
  return library;
}

const isDark = () => document.documentElement.classList.contains("dark");

let nextId = 0;
/** Latest render request per container: older, slower renders are dropped. */
const requests = new WeakMap<HTMLElement, number>();
/** What each container shows, to redraw it when the theme changes. */
const sources = new WeakMap<HTMLElement, { code: string; labels: () => MermaidLabels }>();

/**
 * Draws Mermaid diagrams for `MermaidPreview` (T7.14). Runs in the browser only, with
 * `securityLevel: "strict"` (no scripts, no click handlers, sanitized labels).
 */
export function createMermaidRenderer(labels: () => MermaidLabels): MermaidRender {
  watchTheme();
  return (code, container) => {
    sources.set(container, { code, labels });
    void draw(code, container, labels());
  };
}

async function draw(code: string, container: HTMLElement, labels: MermaidLabels) {
  const request = ++nextId;
  requests.set(container, request);
  const current = () => requests.get(container) === request && container.isConnected;

  if (!code.trim()) {
    container.dataset.state = "empty";
    container.removeAttribute("role");
    container.replaceChildren();
    return;
  }
  // Keep the previous drawing while the new one renders; show a placeholder only the first time.
  if (container.dataset.state !== "ok") {
    container.dataset.state = "loading";
    const loading = document.createElement("p");
    loading.textContent = labels.loading;
    container.replaceChildren(loading);
  }
  container.setAttribute("aria-busy", "true");

  const id = `kb-mermaid-${request}`;
  try {
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: isDark() ? "dark" : "default",
      fontFamily: "inherit",
    });
    await mermaid.parse(code);
    const { svg } = await mermaid.render(id, code);
    if (!current()) return;
    container.innerHTML = svg;
    container.dataset.state = "ok";
    container.setAttribute("role", "img");
    container.setAttribute("aria-label", labels.diagram);
  } catch (error) {
    if (!current()) return;
    const title = document.createElement("p");
    title.textContent = labels.error;
    const details = document.createElement("pre");
    // The parser's own message (line, expected token) — technical detail, like a compiler error.
    details.textContent = error instanceof Error ? error.message : String(error);
    container.replaceChildren(title, details);
    container.dataset.state = "error";
    container.removeAttribute("role");
    container.removeAttribute("aria-label");
  } finally {
    // Mermaid measures text in a temporary element; drop it if a failed render left it behind.
    document.getElementById(`d${id}`)?.remove();
    if (requests.get(container) === request) container.removeAttribute("aria-busy");
  }
}

let themeObserver: MutationObserver | null = null;

/** Redraws every diagram on screen when the light/dark theme switches. */
function watchTheme() {
  if (themeObserver || typeof MutationObserver === "undefined") return;
  let dark = isDark();
  themeObserver = new MutationObserver(() => {
    if (isDark() === dark) return;
    dark = isDark();
    document.querySelectorAll<HTMLElement>(`.${MERMAID_PREVIEW_CLASS}`).forEach((container) => {
      const source = sources.get(container);
      if (source) void draw(source.code, container, source.labels());
    });
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
}
