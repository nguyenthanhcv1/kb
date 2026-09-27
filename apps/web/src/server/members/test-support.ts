import type { DbResult, MembersDb, MembersQuery, MembersRpc, MembersTable } from "./index";

/**
 * Scripted stand-in for the Supabase client, used only by this module's unit tests. Unlike the
 * Space fake it does not re-implement RLS: every query is recorded as a {@link RecordedCall} and
 * answered by the test's `respond` function, so tests pin down how DB answers (rows, RLS-empty
 * results, trigger errors) map to results and `MemberError` codes. Real RLS/trigger behaviour is
 * covered by pgTAP (`supabase/tests/members_invitations.test.sql`) and the PostgREST integration
 * test (`members.integration.test.ts`).
 */
export interface RecordedCall {
  kind: "from" | "rpc";
  target: MembersTable | MembersRpc;
  /** `select` / `insert` / `update` / `delete` (last one wins), `rpc` for RPCs. */
  action: "select" | "insert" | "update" | "delete" | "rpc";
  columns?: string;
  payload?: Record<string, unknown>;
  args?: Record<string, unknown>;
  filters: { op: "eq" | "is" | "gt"; column: string; value: unknown }[];
  single: boolean;
}

export type Responder = (call: RecordedCall) => DbResult<unknown>;

export const ok = (data: unknown): DbResult<unknown> => ({ data, error: null });
export const fail = (code: string, message = code): DbResult<unknown> => ({
  data: null,
  error: { code, message },
});

/** Value of an `eq` filter on `column`, if any. */
export function filterValue(call: RecordedCall, column: string): unknown {
  return call.filters.find((f) => f.column === column)?.value;
}

class ScriptedQuery implements MembersQuery {
  constructor(
    private readonly call: RecordedCall,
    private readonly db: ScriptedMembersDb,
  ) {}

  select(columns: string): MembersQuery {
    if (this.call.action === "select") this.call.columns = columns;
    return this;
  }
  insert(row: Record<string, unknown>): MembersQuery {
    this.call.action = "insert";
    this.call.payload = row;
    return this;
  }
  update(row: Record<string, unknown>): MembersQuery {
    this.call.action = "update";
    this.call.payload = row;
    return this;
  }
  delete(): MembersQuery {
    this.call.action = "delete";
    return this;
  }
  eq(column: string, value: string): MembersQuery {
    this.call.filters.push({ op: "eq", column, value });
    return this;
  }
  is(column: string, value: null): MembersQuery {
    this.call.filters.push({ op: "is", column, value });
    return this;
  }
  gt(column: string, value: string): MembersQuery {
    this.call.filters.push({ op: "gt", column, value });
    return this;
  }
  order(): MembersQuery {
    return this;
  }
  maybeSingle(): PromiseLike<DbResult<unknown>> {
    this.call.single = true;
    return Promise.resolve(this.db.answer(this.call));
  }
  single(): PromiseLike<DbResult<unknown>> {
    return this.maybeSingle();
  }
  then<TResult1 = DbResult<unknown>, TResult2 = never>(
    onfulfilled?: ((value: DbResult<unknown>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.db.answer(this.call)).then(onfulfilled, onrejected);
  }
}

export class ScriptedMembersDb implements MembersDb {
  readonly calls: RecordedCall[] = [];

  constructor(
    private readonly respond: Responder,
    public currentUserId: string | null = "10000000-0000-4000-8000-000000000001",
  ) {}

  auth = {
    getUser: async () => ({
      data: { user: this.currentUserId ? { id: this.currentUserId } : null },
    }),
  };

  answer(call: RecordedCall): DbResult<unknown> {
    this.calls.push(call);
    return this.respond(call);
  }

  from(table: MembersTable): MembersQuery {
    return new ScriptedQuery(
      { kind: "from", target: table, action: "select", filters: [], single: false },
      this,
    );
  }

  rpc(fn: MembersRpc, args: Record<string, unknown>): PromiseLike<DbResult<unknown>> {
    return Promise.resolve(
      this.answer({ kind: "rpc", target: fn, action: "rpc", args, filters: [], single: false }),
    );
  }

  /** Calls matching `target` (and optionally `action`). */
  callsTo(target: MembersTable | MembersRpc, action?: RecordedCall["action"]): RecordedCall[] {
    return this.calls.filter((c) => c.target === target && (!action || c.action === action));
  }
}
