import type { VersionAuthor } from "@/server/versions";

const BLOCK_TYPES = [
  "blockquote",
  "bulletList",
  "codeBlock",
  "heading",
  "image",
  "orderedList",
  "paragraph",
  "table",
  "taskList",
] as const;

/** Message key (under `history.blockTypes`) for a node type. */
export function blockTypeKey(type: string): `blockTypes.${(typeof BLOCK_TYPES)[number] | "other"}` {
  return (BLOCK_TYPES as readonly string[]).includes(type)
    ? (`blockTypes.${type}` as `blockTypes.${(typeof BLOCK_TYPES)[number]}`)
    : "blockTypes.other";
}

/** Display name of a version's author (`null` → caller shows `history.authorUnknown`). */
export function authorName(author: VersionAuthor | null): string | null {
  return author?.name || author?.email || null;
}
