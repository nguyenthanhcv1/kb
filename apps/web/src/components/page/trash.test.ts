import { describe, expect, it } from "vitest";

import type { PageSummary } from "@/server/pages";

import { groupTrash } from "./trash";

const T1 = "2026-09-27T09:00:00+00:00";
const T2 = "2026-09-26T09:00:00+00:00";

function page(id: string, parentId: string | null, deletedAt: string): PageSummary {
  return {
    id: `20000000-0000-4000-8000-00000000000${id}`,
    spaceId: "0b9a0000-0000-4000-8000-000000000001",
    parentId: parentId && `20000000-0000-4000-8000-00000000000${parentId}`,
    shortId: `abcdefg${id}`,
    slug: `trang-${id}`,
    title: `Trang ${id}`,
    icon: null,
    position: "V",
    lastEditedAt: T2,
    deletedAt,
  };
}

describe("groupTrash", () => {
  it("folds a subtree trashed together into its top page", () => {
    const entries = groupTrash([page("1", null, T1), page("2", "1", T1), page("3", "2", T1)]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ subpageCount: 2, parentInTrash: false });
    expect(entries[0]!.page.title).toBe("Trang 1");
  });

  it("keeps pages trashed at another time as their own entries, flagged when the parent is in the trash", () => {
    const entries = groupTrash([page("1", null, T1), page("2", "1", T2), page("4", "9", T2)]);
    expect(
      entries.map((entry) => [entry.page.title, entry.subpageCount, entry.parentInTrash]),
    ).toEqual([
      ["Trang 1", 0, false],
      ["Trang 2", 0, true],
      // Parent "9" is live (not in the trash): restoring puts it back under it.
      ["Trang 4", 0, false],
    ]);
  });

  it("keeps the input order and returns [] for an empty trash", () => {
    expect(groupTrash([])).toEqual([]);
    const entries = groupTrash([page("5", null, T1), page("6", null, T2)]);
    expect(entries.map((entry) => entry.page.title)).toEqual(["Trang 5", "Trang 6"]);
  });
});
