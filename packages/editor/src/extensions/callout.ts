import { mergeAttributes, Node } from "@tiptap/core";

/** Stored as codes in the document; labels and icons are chosen by the UI. */
export const CALLOUT_VARIANTS = ["info", "success", "warning", "danger"] as const;

export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

const DEFAULT_VARIANT: CalloutVariant = "info";

const isVariant = (value: unknown): value is CalloutVariant =>
  CALLOUT_VARIANTS.includes(value as CalloutVariant);

export interface CalloutOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      /** Wrap the selected blocks in a callout. */
      setCallout: (attributes?: { variant?: CalloutVariant }) => ReturnType;
      /** Wrap the selected blocks in a callout, or lift them out of one. */
      toggleCallout: (attributes?: { variant?: CalloutVariant }) => ReturnType;
      /** Lift the selected blocks out of the surrounding callout. */
      unsetCallout: () => ReturnType;
    };
  }
}

/** Highlighted box around one or more blocks (Notion/Confluence style "info panel"). */
export const Callout = Node.create<CalloutOptions>({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      variant: {
        default: DEFAULT_VARIANT,
        parseHTML: (element) => {
          const value = element.getAttribute("data-variant");
          return isVariant(value) ? value : DEFAULT_VARIANT;
        },
        renderHTML: (attributes) => ({ "data-variant": attributes.variant }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({ "data-type": "callout" }, this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return {
      setCallout:
        (attributes) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attributes),
      toggleCallout:
        (attributes) =>
        ({ commands }) =>
          commands.toggleWrap(this.name, attributes),
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift(this.name),
    };
  },
});
