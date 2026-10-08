import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/**
 * Language of a code block holding a Mermaid diagram (T7.14). Diagrams are plain `codeBlock`
 * nodes — no new node type, so the schema, Yjs content, Markdown (```mermaid) and the search
 * extractor stay unchanged; only the web view draws them.
 */
export const MERMAID_LANGUAGE = "mermaid";

/** Starter diagram inserted by the slash item: language-neutral, nothing to translate. */
export const MERMAID_TEMPLATE = "flowchart TD\n  A --> B";

/** Class added to the `<pre>` of a Mermaid code block (the view may hide it once drawn). */
export const MERMAID_SOURCE_CLASS = "kb-mermaid-source";

/** Class of the preview container rendered right after each Mermaid code block. */
export const MERMAID_PREVIEW_CLASS = "kb-mermaid";

/**
 * Draws `code` into `container`. Called again when the code changes (debounced while editing).
 * The renderer sets `data-state` on the container (`ok`, `error`, …) and ignores stale calls.
 */
export type MermaidRender = (code: string, container: HTMLElement) => void;

export interface MermaidPreviewOptions {
  render: MermaidRender;
  /** Delay after the last keystroke before redrawing an editable document (ms). */
  debounce: number;
}

export const mermaidPreviewPluginKey = new PluginKey<DecorationSet>("kbMermaidPreview");

export interface MermaidBlock {
  /** Stable key of the block: its UniqueID, or its position until one is assigned. */
  key: string;
  pos: number;
  node: PmNode;
}

export const isMermaidBlock = (node: PmNode) =>
  node.type.name === "codeBlock" && node.attrs.language === MERMAID_LANGUAGE;

/** Every Mermaid code block of `doc`, in document order (tables and callouts included). */
export function findMermaidBlocks(doc: PmNode): MermaidBlock[] {
  const blocks: MermaidBlock[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "codeBlock") {
      if (isMermaidBlock(node)) {
        const id = node.attrs.id as string | null | undefined;
        blocks.push({ key: id ?? `pos-${pos}`, pos, node });
      }
      return false;
    }
    return true;
  });
  return blocks;
}

function buildDecorations(doc: PmNode): DecorationSet {
  const decorations = findMermaidBlocks(doc).flatMap(({ key, pos, node }) => {
    const end = pos + node.nodeSize;
    return [
      Decoration.node(pos, end, { class: MERMAID_SOURCE_CLASS }),
      // Same key → ProseMirror keeps the container (and its drawing) across edits.
      Decoration.widget(
        end,
        () => {
          const container = document.createElement("div");
          container.className = MERMAID_PREVIEW_CLASS;
          container.contentEditable = "false";
          container.dataset.mermaidBlock = key;
          container.dataset.state = "idle";
          return container;
        },
        { key: `kb-mermaid-${key}`, side: -1, ignoreSelection: true, stopEvent: () => true },
      ),
    ];
  });
  return DecorationSet.create(doc, decorations);
}

class MermaidPreviewView {
  private readonly drawn = new WeakMap<HTMLElement, string>();
  private readonly timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly view: EditorView,
    private readonly options: MermaidPreviewOptions,
  ) {
    this.update();
  }

  update() {
    const containers = new Map<string, HTMLElement>();
    this.view.dom
      .querySelectorAll<HTMLElement>(`.${MERMAID_PREVIEW_CLASS}[data-mermaid-block]`)
      .forEach((el) => {
        if (!containers.has(el.dataset.mermaidBlock!)) containers.set(el.dataset.mermaidBlock!, el);
      });
    for (const { key, node } of findMermaidBlocks(this.view.state.doc)) {
      const container = containers.get(key);
      const code = node.textContent;
      if (!container || this.drawn.get(container) === code) continue;
      this.drawn.set(container, code);
      clearTimeout(this.timers.get(container));
      // First drawing and read-only views: right away; while typing: after a pause.
      const delay =
        container.dataset.state === "idle" || !this.view.editable ? 0 : this.options.debounce;
      this.timers.set(
        container,
        setTimeout(() => {
          this.timers.delete(container);
          if (container.isConnected) this.options.render(code, container);
        }, delay),
      );
    }
  }

  destroy() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

/**
 * Draws a preview under every ```mermaid code block (T7.14). Rendering is injected (`render`) so
 * this package never loads the Mermaid library; decorations are local to the view and never reach
 * the document or Yjs.
 */
export const MermaidPreview = Extension.create<MermaidPreviewOptions>({
  name: "mermaidPreview",

  addOptions() {
    return { render: () => {}, debounce: 400 };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<DecorationSet>({
        key: mermaidPreviewPluginKey,
        state: {
          init: (_, state) => buildDecorations(state.doc),
          apply: (tr, old) => (tr.docChanged ? buildDecorations(tr.doc) : old),
        },
        props: {
          decorations: (state) => mermaidPreviewPluginKey.getState(state),
        },
        view: (view) => new MermaidPreviewView(view, options),
      }),
    ];
  },
});
