import { UniqueID } from "@tiptap/extension-unique-id";
import { TrailingNode } from "@tiptap/extensions";
import { Plugin, type Transaction } from "@tiptap/pm/state";

/**
 * Opening a page must not change it. With the document bound to Yjs, any ProseMirror change a
 * plugin appends on load is a real Yjs update: kb-collab stores it, sets `last_edited_by` to
 * whoever only looked at the page, writes an audit entry and a page version — and two people
 * opening the page at once each append their own copy (two trailing paragraphs). For a viewer
 * the server refuses the update and the status stays "saving".
 *
 * The two stock extensions below did that; their variants only act on a change typed here.
 */

/** y-tiptap's sync plugin key (`ySyncPluginKey`): set on transactions it applies from Yjs. */
const Y_SYNC_META = "y-sync$";

/** The transaction comes from the shared Yjs document (first render, a collaborator, restore). */
export function isRemoteTransaction(tr: Transaction): boolean {
  const meta = tr.getMeta(Y_SYNC_META) as { isChangeOrigin?: boolean } | undefined;
  return meta?.isChangeOrigin === true;
}

/** Some transaction changed the document locally (typing, a command, a paste…). */
function hasLocalDocChange(transactions: readonly Transaction[]): boolean {
  return transactions.some((tr) => tr.docChanged && !isRemoteTransaction(tr));
}

/**
 * Empty paragraph after a last block that cannot take the cursor (table, code block…), added on
 * the next local edit instead of on any transaction — the stock one adds it on the first render
 * of every such page. Until then the gap cursor (StarterKit) reaches the end of the page.
 */
export const QuietTrailingNode = TrailingNode.extend({
  addProseMirrorPlugins() {
    return (this.parent?.() ?? []).map(
      (plugin) =>
        new Plugin({
          ...plugin.spec,
          appendTransaction: (transactions, oldState, newState) =>
            hasLocalDocChange(transactions)
              ? plugin.spec.appendTransaction?.(transactions, oldState, newState)
              : undefined,
        }),
    );
  },
});

/**
 * UniqueID without its pass over the whole document on the first Yjs sync (used when the
 * Collaboration extension has no provider, which is how the web editor binds it). That pass gave
 * an ID to every block without one — including the empty paragraph ProseMirror shows for a new,
 * empty page — and wrote it back. New and changed blocks still get IDs as they are edited.
 */
export const QuietUniqueID = UniqueID.extend({
  addProseMirrorPlugins() {
    const plugins = this.parent?.() ?? [];
    (this.storage as { needsInitialIdGeneration?: boolean }).needsInitialIdGeneration = false;
    return plugins;
  },
});
