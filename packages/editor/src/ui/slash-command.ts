import { type Editor, Extension, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { Suggestion, type SuggestionOptions } from "@tiptap/suggestion";

import { type SlashItem, SLASH_ITEMS } from "./slash-items";

export const slashCommandPluginKey = new PluginKey("slashCommand");

export interface SlashSelectProps {
  editor: Editor;
  /** Range of the "/query" text, still present in the document. */
  range: Range;
  item: SlashItem;
}

export interface SlashCommandOptions {
  /** Items for a query; the UI filters with translated labels (see `filterSlashItems`). */
  items: (query: string) => SlashItem[];
  /** Popup lifecycle (the web editor renders a React list). Without it the menu is headless. */
  render?: SuggestionOptions<SlashItem, SlashItem>["render"];
  /**
   * Called when an item is picked. Default: `runSlashItem`. Override to collect input first
   * (items with `input`, e.g. an image URL).
   */
  onSelect: (props: SlashSelectProps) => void;
}

/** Removes the "/query" text and runs the item's block command as one undo step. */
export function runSlashItem({ editor, range, item }: SlashSelectProps, input?: { src?: string }) {
  return item.run(editor.chain().focus().deleteRange(range), input).run();
}

/**
 * "/" menu: typing "/" at the start of a word opens the block list. Not offered inside code
 * blocks (where "/" is ordinary text).
 */
export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      items: () => [...SLASH_ITEMS],
      render: undefined,
      onSelect: (props) => {
        runSlashItem(props);
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: slashCommandPluginKey,
        char: "/",
        // Vietnamese labels have spaces ("tiêu đề"); a leading or double space, or a query with
        // spaces that matches nothing, closes the menu so ordinary typing is not trapped.
        allowSpaces: true,
        shouldShow: ({ query }) =>
          !/^\s|\s\s/.test(query) && (!/\s/.test(query) || this.options.items(query).length > 0),
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          return !$from.parent.type.spec.code;
        },
        items: ({ query }) => this.options.items(query),
        command: ({ editor, range, props }) =>
          this.options.onSelect({ editor, range, item: props }),
        render: this.options.render,
      }),
    ];
  },
});
