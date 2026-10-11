import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { getPageByShortId, listRecentPages, PageError, setPageIcon } from "./index";

const row = {
  id: "20000000-0000-4000-8000-000000000001",
  space_id: "0b9a0000-0000-4000-8000-000000000001",
  parent_id: null,
  short_id: "a1B2c3D4",
  slug: "huong-dan",
  title: "Hướng dẫn",
  icon: "📘",
  position: "V",
  last_edited_at: "2026-09-26T09:00:00+00:00",
  deleted_at: null,
};

/** Minimal PostgREST query builder: every call chains, awaiting resolves `result`. */
function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: [string, ...unknown[]][] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "limit", "update"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.maybeSingle = () => Promise.resolve(result);
  builder.then = (resolve: (value: unknown) => void) => resolve(result);
  const from = vi.fn(() => builder);
  return { client: { from } as unknown as SupabaseClient, from, calls };
}

describe("getPageByShortId", () => {
  it("returns the page with the slug of its Space", async () => {
    const { client, from, calls } = fakeClient({
      data: { ...row, space: { slug: "design" } },
      error: null,
    });
    const page = await getPageByShortId(client, { shortId: "a1B2c3D4" });
    expect(from).toHaveBeenCalledWith("pages");
    expect(calls).toContainEqual(["eq", "short_id", "a1B2c3D4"]);
    expect(page).toMatchObject({ id: row.id, slug: "huong-dan", shortId: "a1B2c3D4" });
    expect(page?.spaceSlug).toBe("design");
  });

  it("returns null for a malformed short id without querying, or an invisible page", async () => {
    const empty = fakeClient({ data: null, error: null });
    expect(await getPageByShortId(empty.client, { shortId: "nope" })).toBeNull();
    expect(empty.from).not.toHaveBeenCalled();
    expect(await getPageByShortId(empty.client, { shortId: "a1B2c3D4" })).toBeNull();
  });

  it("maps database errors to page error codes", async () => {
    const { client } = fakeClient({ data: null, error: { code: "42501", message: "denied" } });
    await expect(getPageByShortId(client, { shortId: "a1B2c3D4" })).rejects.toSatisfy(
      (error) => error instanceof PageError && error.code === "FORBIDDEN",
    );
  });
});

describe("listRecentPages", () => {
  const embedded = (title: string, space: unknown) => ({ ...row, title, space });

  it("reads live pages of active Spaces, newest first, with their Space", async () => {
    const { client, from, calls } = fakeClient({
      data: [
        embedded("Quy trình", { slug: "spe", name: "Shopee Express", icon: "🛍️" }),
        embedded("Không icon", { slug: "kas", name: "KAS", icon: null }),
      ],
      error: null,
    });
    const pages = await listRecentPages(client, { limit: 5 });
    expect(from).toHaveBeenCalledWith("pages");
    expect(calls).toContainEqual(["is", "deleted_at", null]);
    expect(calls).toContainEqual(["is", "space.archived_at", null]);
    expect(calls).toContainEqual(["order", "last_edited_at", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 5]);
    expect(
      pages.map((page) => [page.title, page.spaceSlug, page.spaceName, page.spaceIcon]),
    ).toEqual([
      ["Quy trình", "spe", "Shopee Express", "🛍️"],
      ["Không icon", "kas", "KAS", null],
    ]);
  });

  it("defaults to 8 pages and drops rows without a readable Space", async () => {
    const { client, calls } = fakeClient({
      data: [embedded("Mồ côi", null), embedded("Ok", { slug: "kas", name: "KAS", icon: null })],
      error: null,
    });
    const pages = await listRecentPages(client);
    expect(calls).toContainEqual(["limit", 8]);
    expect(pages.map((page) => page.title)).toEqual(["Ok"]);
  });

  it("rejects a limit outside 1-50 and maps database errors", async () => {
    const { client } = fakeClient({ data: null, error: { code: "42501", message: "denied" } });
    await expect(listRecentPages(client, { limit: 0 })).rejects.toSatisfy(
      (error) => error instanceof PageError && error.code === "VALIDATION_FAILED",
    );
    await expect(listRecentPages(client)).rejects.toSatisfy(
      (error) => error instanceof PageError && error.code === "FORBIDDEN",
    );
  });
});

describe("setPageIcon", () => {
  it("rejects icons longer than the limit", async () => {
    const { client } = fakeClient({ data: row, error: null });
    await expect(setPageIcon(client, { pageId: row.id, icon: "x".repeat(65) })).rejects.toSatisfy(
      (error) => error instanceof PageError && error.code === "VALIDATION_FAILED",
    );
  });
});
