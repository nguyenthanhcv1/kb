import type { ProfileDb } from "./index";

/** Test-only stand-in for the Supabase client: one `profiles` table, the caller's own row. */
export type FakeProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  locale: string;
  time_zone: string;
};

export class FakeProfileDb implements ProfileDb {
  updates: Record<string, unknown>[] = [];
  /** Error the next `update` returns (e.g. `{ code: "23514" }`). */
  failUpdate: { code?: string; message: string } | null = null;

  constructor(
    public rows: FakeProfileRow[],
    public currentUserId: string | null,
  ) {}

  auth = {
    getUser: async () => ({
      data: { user: this.currentUserId ? { id: this.currentUserId } : null },
    }),
  };

  from() {
    let patch: Record<string, unknown> | null = null;
    let id: string | null = null;
    const query = {
      select: () => query,
      update: (row: Record<string, unknown>) => {
        patch = row;
        return query;
      },
      eq: (_column: string, value: string) => {
        id = value;
        return query;
      },
      maybeSingle: async () => {
        // RLS: the caller only reads/updates their own row in these tests.
        const row = this.rows.find((r) => r.id === id && r.id === this.currentUserId);
        if (patch) {
          this.updates.push(patch);
          if (this.failUpdate) return { data: null, error: this.failUpdate };
          if (row) Object.assign(row, patch);
        }
        return { data: row ? { ...row } : null, error: null };
      },
    };
    return query;
  }
}
