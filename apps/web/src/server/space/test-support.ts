import type { SpaceDb, SpaceRole, SpaceVisibility } from "./index";

interface FakeResult<T> {
  data: T | null;
  error: { code?: string; message: string } | null;
}

/**
 * In-memory stand-in for the Supabase client, used only by this module's tests. It reimplements,
 * in TypeScript, the same authorization algorithm as `app.space_role` / `app.is_space_admin`
 * (docs/PLAN.md §3.4) so the tests can exercise `SpaceError` branches (`FORBIDDEN`,
 * `SPACE_NOT_FOUND`, `SPACE_SLUG_TAKEN`) the way Postgres RLS would produce them — production code
 * never performs this computation itself; it always defers to the real database.
 */

export interface FakeSpaceRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  visibility: SpaceVisibility;
  ai_enabled: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface FakeMember {
  space_id: string;
  user_id: string;
  role: SpaceRole;
}

export interface FakeProfile {
  id: string;
  is_super_admin: boolean;
  is_guest: boolean;
}

interface Filter {
  type: "eq" | "ilike" | "is";
  column: string;
  value: unknown;
}

const PG_UNIQUE_VIOLATION = "23505";
const SPACE_COLUMNS = [
  "id",
  "slug",
  "name",
  "description",
  "icon",
  "visibility",
  "ai_enabled",
  "created_by",
  "created_at",
  "updated_at",
] as const;

function projectSpace(row: FakeSpaceRow): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const column of SPACE_COLUMNS) projected[column] = row[column];
  return projected;
}

function matchesIlike(value: string, pattern: string): boolean {
  const needle = pattern.replace(/^%|%$/g, "").toLowerCase();
  return value.toLowerCase().includes(needle);
}

export class FakeSpaceDb implements SpaceDb {
  spaces: FakeSpaceRow[];
  members: FakeMember[];
  profiles: FakeProfile[];
  currentUserId: string | null;

  constructor(seed: {
    spaces?: FakeSpaceRow[];
    members?: FakeMember[];
    profiles?: FakeProfile[];
    currentUserId?: string | null;
  }) {
    this.spaces = seed.spaces ?? [];
    this.members = seed.members ?? [];
    this.profiles = seed.profiles ?? [];
    this.currentUserId = seed.currentUserId ?? null;
  }

  auth = {
    getUser: async () => ({
      data: { user: this.currentUserId ? { id: this.currentUserId } : null },
    }),
  };

  /** Mirrors `app.space_role`: super admin > member role > internal-visibility viewer > none. */
  roleFor(userId: string, row: FakeSpaceRow): SpaceRole | null {
    if (row.archived_at) return null;
    const profile = this.profiles.find((p) => p.id === userId);
    if (!profile) return null;
    if (profile.is_super_admin) return "admin";
    const member = this.members.find((m) => m.space_id === row.id && m.user_id === userId);
    if (member) return member.role;
    if (row.visibility === "internal" && !profile.is_guest) return "viewer";
    return null;
  }

  canView(userId: string, row: FakeSpaceRow): boolean {
    return this.roleFor(userId, row) !== null;
  }

  isAdmin(userId: string, row: FakeSpaceRow): boolean {
    return this.roleFor(userId, row) === "admin";
  }

  isInternalUser(userId: string): boolean {
    return this.profiles.find((p) => p.id === userId)?.is_guest === false;
  }

  from(table: "spaces"): FakeSpacesQuery;
  from(table: "space_members"): FakeMembersQuery;
  from(table: "profiles"): FakeProfilesQuery;
  from(table: "spaces" | "space_members" | "profiles"): unknown {
    if (table === "spaces") return new FakeSpacesQuery(this);
    if (table === "space_members") return new FakeMembersQuery(this);
    return new FakeProfilesQuery(this);
  }
}

class FakeSpacesQuery {
  private mode: "select" | "insert" | "update" = "select";
  /** `.insert(…).select(…)`, i.e. `INSERT … RETURNING`. */
  private returning = false;
  private payload: Record<string, unknown> = {};
  private filters: Filter[] = [];
  private ordered: { column: string; ascending: boolean } | null = null;

  constructor(private readonly db: FakeSpaceDb) {}

  select(): this {
    if (this.mode === "insert") this.returning = true;
    return this;
  }

  insert(row: Record<string, unknown>): this {
    this.mode = "insert";
    this.payload = row;
    return this;
  }

  update(row: Record<string, unknown>): this {
    this.mode = "update";
    this.payload = row;
    return this;
  }

  eq(column: string, value: string): this {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  ilike(column: string, value: string): this {
    this.filters.push({ type: "ilike", column, value });
    return this;
  }

  is(column: string, value: null): this {
    this.filters.push({ type: "is", column, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.ordered = { column, ascending: options?.ascending ?? true };
    return this;
  }

  private visibleRows(): FakeSpaceRow[] {
    const userId = this.db.currentUserId;
    let rows = this.db.spaces.filter((row) => (userId ? this.db.canView(userId, row) : false));
    for (const filter of this.filters) {
      rows = rows.filter((row) => {
        const actual = row[filter.column as keyof FakeSpaceRow];
        if (filter.type === "eq") return actual === filter.value;
        if (filter.type === "is") return actual === null;
        return typeof actual === "string" && matchesIlike(actual, filter.value as string);
      });
    }
    if (this.ordered) {
      const { column, ascending } = this.ordered;
      rows = [...rows].sort((a, b) => {
        const av = String(a[column as keyof FakeSpaceRow]);
        const bv = String(b[column as keyof FakeSpaceRow]);
        return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    return rows;
  }

  private runInsert(): FakeResult<Record<string, unknown>> {
    const slug = String(this.payload.slug);
    if (this.db.spaces.some((row) => row.slug.toLowerCase() === slug.toLowerCase())) {
      return { data: null, error: { code: PG_UNIQUE_VIOLATION, message: "duplicate key value" } };
    }
    const userId = this.db.currentUserId;
    if (!userId || !this.db.isInternalUser(userId)) {
      return { data: null, error: { code: "42501", message: "row-level security violation" } };
    }
    // Real Postgres: `RETURNING` applies `spaces_select` (`app.can_view_space`) to the new row, which
    // the helper's statement snapshot cannot see yet — so it always fails like this.
    if (this.returning) {
      return { data: null, error: { code: "42501", message: "row-level security violation" } };
    }
    const now = new Date().toISOString();
    const row: FakeSpaceRow = {
      id:
        (this.payload.id as string | undefined) ??
        `20000000-0000-4000-8000-${String(this.db.spaces.length + 1).padStart(12, "0")}`,
      slug,
      name: String(this.payload.name),
      description: (this.payload.description as string | null | undefined) ?? null,
      icon: (this.payload.icon as string | null | undefined) ?? null,
      visibility: (this.payload.visibility as SpaceVisibility | undefined) ?? "restricted",
      ai_enabled: (this.payload.ai_enabled as boolean | undefined) ?? true,
      created_by: String(this.payload.created_by),
      created_at: now,
      updated_at: now,
      archived_at: null,
    };
    this.db.spaces.push(row);
    // The DB trigger `app.add_space_creator_as_admin` would insert this row; the fake mirrors it
    // so a subsequent `listSpaces`/`updateSpace` call sees the creator as admin.
    this.db.members.push({ space_id: row.id, user_id: row.created_by, role: "admin" });
    return { data: null, error: null };
  }

  private runUpdate(): FakeResult<Record<string, unknown>> {
    const idFilter = this.filters.find((f) => f.type === "eq" && f.column === "id");
    const row = this.db.spaces.find((r) => r.id === idFilter?.value);
    if (!row) return { data: null, error: null };

    if (this.payload.slug !== undefined) {
      const slug = String(this.payload.slug);
      const clashes = this.db.spaces.some(
        (other) => other.id !== row.id && other.slug.toLowerCase() === slug.toLowerCase(),
      );
      if (clashes)
        return { data: null, error: { code: PG_UNIQUE_VIOLATION, message: "duplicate key value" } };
    }

    const userId = this.db.currentUserId;
    // `spaces_update`'s USING clause: only a Space admin can update, RLS-style (no error, zero rows).
    if (!userId || !this.db.isAdmin(userId, row)) return { data: null, error: null };

    Object.assign(row, this.payload);
    row.updated_at = new Date().toISOString();
    return { data: projectSpace(row), error: null };
  }

  single(): PromiseLike<FakeResult<unknown>> {
    return this.maybeSingle();
  }

  maybeSingle(): PromiseLike<FakeResult<unknown>> {
    if (this.mode === "insert") return Promise.resolve(this.runInsert());
    if (this.mode === "update") return Promise.resolve(this.runUpdate());
    const [row] = this.visibleRows();
    return Promise.resolve({ data: row ? projectSpace(row) : null, error: null });
  }

  then<TResult1 = FakeResult<unknown[]>, TResult2 = never>(
    onfulfilled?: ((value: FakeResult<unknown[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    if (this.mode === "insert") {
      const { error } = this.runInsert();
      return Promise.resolve({ data: null, error } as FakeResult<unknown[]>).then(
        onfulfilled,
        onrejected,
      );
    }
    const result: FakeResult<unknown[]> = {
      data: this.visibleRows().map(projectSpace),
      error: null,
    };
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

class FakeMembersQuery {
  private filters: Filter[] = [];

  constructor(private readonly db: FakeSpaceDb) {}

  select(): this {
    return this;
  }

  eq(column: string, value: string): this {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  then<TResult1 = FakeResult<unknown[]>, TResult2 = never>(
    onfulfilled?: ((value: FakeResult<unknown[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    let rows = this.db.members;
    for (const filter of this.filters) {
      rows = rows.filter((row) => row[filter.column as keyof FakeMember] === filter.value);
    }
    const data = rows.map((row) => ({ space_id: row.space_id, role: row.role }));
    const result: FakeResult<unknown[]> = { data, error: null };
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

class FakeProfilesQuery {
  private filters: Filter[] = [];

  constructor(private readonly db: FakeSpaceDb) {}

  select(): this {
    return this;
  }

  eq(column: string, value: string): this {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  single(): PromiseLike<FakeResult<unknown>> {
    const idFilter = this.filters.find((f) => f.column === "id");
    const profile = this.db.profiles.find((p) => p.id === idFilter?.value);
    if (!profile) return Promise.resolve({ data: null, error: { message: "not found" } });
    return Promise.resolve({
      data: { is_super_admin: profile.is_super_admin, is_guest: profile.is_guest },
      error: null,
    });
  }
}
