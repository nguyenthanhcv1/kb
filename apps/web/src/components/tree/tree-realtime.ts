import type { PageSummary } from "@/server/pages";

/** `pages` row as delivered by Supabase Realtime (`postgres_changes`, snake_case). */
type PageRow = Record<string, unknown>;

const str = (value: unknown): value is string => typeof value === "string";

/** Maps a Realtime row to {@link PageSummary}; `null` when it lacks the columns the tree needs. */
export function pageFromRow(row: PageRow): PageSummary | null {
  const { id, space_id, short_id, slug, title, position, last_edited_at } = row;
  if (
    !str(id) ||
    !str(space_id) ||
    !str(short_id) ||
    !str(slug) ||
    !str(title) ||
    !str(position) ||
    !str(last_edited_at)
  ) {
    return null;
  }
  return {
    id,
    spaceId: space_id,
    parentId: str(row.parent_id) ? row.parent_id : null,
    shortId: short_id,
    slug,
    title,
    icon: str(row.icon) ? row.icon : null,
    position,
    lastEditedAt: last_edited_at,
    deletedAt: str(row.deleted_at) ? row.deleted_at : null,
  };
}
