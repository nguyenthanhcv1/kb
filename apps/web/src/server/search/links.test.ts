import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { SearchError, type SearchResult } from "./index";
import { withPageLinks } from "./links";

const result = (id: string): SearchResult => ({
  pageId: id,
  spaceId: "10000000-0000-4000-8000-00000000000a",
  title: "T",
  snippetHtml: "",
  matchIn: "title",
  score: 1,
  lastEditedAt: "2026-09-26T09:00:00+00:00",
});

const A = "20000000-0000-4000-8000-000000000001";
const B = "20000000-0000-4000-8000-000000000002";

function client(data: unknown, error: unknown = null) {
  const builder = { select: () => builder, in: () => Promise.resolve({ data, error }) };
  return { from: () => builder } as unknown as Pick<SupabaseClient, "from">;
}

describe("withPageLinks", () => {
  it("adds the canonical href and keeps result order, dropping unreadable pages", async () => {
    const db = client([
      {
        id: A,
        slug: "huong-dan",
        short_id: "a1B2c3D4",
        icon: "📘",
        space: { slug: "design", name: "Design" },
      },
    ]);
    const hits = await withPageLinks(db, [result(B), result(A)]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      pageId: A,
      href: "/s/design/p/huong-dan-a1B2c3D4",
      spaceName: "Design",
      icon: "📘",
    });
  });

  it("does not query for an empty list and maps errors", async () => {
    expect(await withPageLinks(client(null), [])).toEqual([]);
    await expect(withPageLinks(client(null, { message: "x" }), [result(A)])).rejects.toBeInstanceOf(
      SearchError,
    );
  });
});
