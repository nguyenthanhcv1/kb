import { afterEach, describe, expect, it, vi } from "vitest";

import { type ChangelogEntry, getAboutInfo, releaseNotesFor } from "./index";

const ENTRIES: ChangelogEntry[] = [
  { version: "0.2.0", date: "2026-10-12", en: "### Added\n\n* Spaces", vi: "### Thêm\n\n- Space" },
  { version: "0.1.0", date: "2026-09-30", en: "### Added\n\n* Sign in", vi: null },
];

describe("releaseNotesFor", () => {
  it("uses the Vietnamese notes when they exist and falls back to English with a flag", () => {
    expect(releaseNotesFor(ENTRIES, "vi")).toEqual([
      {
        version: "0.2.0",
        date: "2026-10-12",
        markdown: "### Thêm\n\n- Space",
        language: "vi",
        isFallback: false,
      },
      {
        version: "0.1.0",
        date: "2026-09-30",
        markdown: "### Added\n\n* Sign in",
        language: "en",
        isFallback: true,
      },
    ]);
  });

  it("always shows the English notes in English, never as a fallback", () => {
    const notes = releaseNotesFor(ENTRIES, "en");
    expect(notes.map((n) => [n.markdown, n.language, n.isFallback])).toEqual([
      ["### Added\n\n* Spaces", "en", false],
      ["### Added\n\n* Sign in", "en", false],
    ]);
  });
});

describe("getAboutInfo", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function stubEnv(collabUrl: string) {
    vi.stubEnv("APP_VERSION", "0.3.0");
    vi.stubEnv("GIT_SHA", "3f2c9e1aa");
    vi.stubEnv("APP_ENV", "local");
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    vi.stubEnv("COLLAB_INTERNAL_URL", collabUrl);
  }

  it("adds kb-collab's version from its /health endpoint", async () => {
    stubEnv("http://kb-collab:3001");
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { status: "degraded", version: "0.3.0", sha: "3f2c9e1aa", schemaVersion: 2, env: "local" },
        { status: 503 },
      ),
    );
    await expect(getAboutInfo(fetchImpl)).resolves.toEqual({
      version: "0.3.0",
      sha: "3f2c9e1aa",
      env: "local",
      collab: { version: "0.3.0", sha: "3f2c9e1aa", schemaVersion: 2 },
    });
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe("http://kb-collab:3001/health");
  });

  it("returns collab: null when collab is unreachable or answers garbage", async () => {
    stubEnv("http://kb-collab:3001");
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect((await getAboutInfo(down)).collab).toBeNull();
    const garbage = vi.fn(async () => new Response("<html>", { status: 502 }));
    expect((await getAboutInfo(garbage)).collab).toBeNull();
  });
});
