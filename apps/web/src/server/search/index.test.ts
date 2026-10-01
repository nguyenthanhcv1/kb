import { describe, expect, it, vi } from "vitest";

import { SearchError, sanitizeSnippet, searchPages, toSearchError, type SearchDb } from "./index";

const PAGE = "20000000-0000-4000-8000-000000000001";
const SPACE = "10000000-0000-4000-8000-00000000000a";

function dbReturning(result: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null, ...result });
  return { db: { rpc } as unknown as SearchDb, rpc };
}

describe("sanitizeSnippet", () => {
  it("keeps <mark> and escapes everything else", () => {
    expect(sanitizeSnippet('a <mark>b</mark> <img src=x onerror="1"> & c')).toBe(
      "a <mark>b</mark> &lt;img src=x onerror=&quot;1&quot;&gt; &amp; c",
    );
  });
});

describe("searchPages", () => {
  it("calls the RPC with defaults and maps rows", async () => {
    const { db, rpc } = dbReturning({
      data: [
        {
          page_id: PAGE,
          space_id: SPACE,
          title: "Quy trình nghỉ phép",
          snippet: "xin <mark>nghỉ</mark> <script>",
          match_in: "table",
          score: 1.2,
          last_edited_at: "2026-09-26T09:00:00+00:00",
        },
      ],
    });
    const out = await searchPages(db, { q: "  nghi phep " });
    expect(rpc).toHaveBeenCalledWith("search_pages", {
      q: "nghi phep",
      space_ids: null,
      limit: 20,
      offset: 0,
    });
    expect(out.results).toEqual([
      {
        pageId: PAGE,
        spaceId: SPACE,
        title: "Quy trình nghỉ phép",
        snippetHtml: "xin <mark>nghỉ</mark> &lt;script&gt;",
        matchIn: "table",
        score: 1.2,
        lastEditedAt: "2026-09-26T09:00:00+00:00",
      },
    ]);
  });

  it("passes the Space filter", async () => {
    const { db, rpc } = dbReturning({ data: [] });
    await searchPages(db, { q: "x", spaceIds: [SPACE], limit: 5, offset: 10 });
    expect(rpc).toHaveBeenCalledWith("search_pages", {
      q: "x",
      space_ids: [SPACE],
      limit: 5,
      offset: 10,
    });
  });

  it.each([
    { q: "   " },
    { q: "x".repeat(201) },
    { q: "x", limit: 51 },
    { q: "x", limit: 0 },
    { q: "x", offset: -1 },
    { q: "x", spaceIds: ["nope"] },
  ])("rejects invalid input %j", async (input) => {
    const { db, rpc } = dbReturning({ data: [] });
    await expect(searchPages(db, input)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps RATE_LIMITED with Retry-After seconds", async () => {
    const { db } = dbReturning({
      error: { code: "P0001", message: "RATE_LIMITED", hint: "42" },
    });
    await expect(searchPages(db, { q: "x" })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryAfterSeconds: 42,
    });
  });

  it("maps other database errors to SEARCH_FAILED and privilege errors to FORBIDDEN", async () => {
    expect(toSearchError({ code: "XX000", message: "boom" }).code).toBe("SEARCH_FAILED");
    expect(toSearchError({ code: "42501", message: "denied" }).code).toBe("FORBIDDEN");
    expect(toSearchError(new SearchError("UNAUTHORIZED")).code).toBe("UNAUTHORIZED");
  });

  it("fails on rows that do not match the contract", async () => {
    const { db } = dbReturning({ data: [{ page_id: "x" }] });
    await expect(searchPages(db, { q: "x" })).rejects.toMatchObject({ code: "SEARCH_FAILED" });
  });
});
