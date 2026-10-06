import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { McpScope } from "./constants";

/**
 * Settings › AI assistants contract: the signed-in user's MCP connections (assistants they
 * authorised over OAuth and personal tokens they created). Reads and revocations go through RLS
 * with the user's own client; creating a personal token needs service_role (`./oauth.ts`).
 *
 * ```ts
 * await listMyConnections(supabase);
 * // [{ id: "3000…", kind: "assistant", name: "Claude", scope: "write",
 * //    createdAt: "2026-10-06T08:00:00+00:00", lastUsedAt: "2026-10-06T08:05:00+00:00",
 * //    expiresAt: null },
 * //  { id: "3000…", kind: "personal", name: "Laptop – Claude Code", scope: "read",
 * //    createdAt: "…", lastUsedAt: null, expiresAt: "2027-01-04T08:00:00+00:00" }]
 * ```
 */

export const MCP_ERROR_CODES = [
  "FORBIDDEN",
  "MCP_CONNECTION_LIMIT",
  "MCP_NOT_CONFIGURED",
  "PAGE_ACTION_FAILED",
  "UNAUTHORIZED",
  "VALIDATION_FAILED",
] as const;
export type McpErrorCode = (typeof MCP_ERROR_CODES)[number];

export class McpConnectionError extends Error {
  constructor(
    readonly code: McpErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = "McpConnectionError";
  }
}

export type McpConnection = {
  id: string;
  /** `assistant` = authorised over OAuth (claude.ai, ChatGPT…); `personal` = token from Settings. */
  kind: "assistant" | "personal";
  /** Client name or token name: user content, not translated. */
  name: string;
  scope: McpScope;
  /** ISO 8601 (UTC). */
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

const rowSchema = z.object({
  id: z.string(),
  client_id: z.string().nullable(),
  name: z.string(),
  scope: z.enum(["read", "write"]),
  created_at: z.string(),
  last_used_at: z.string().nullable(),
  expires_at: z.string().nullable(),
});

/** Active connections (not revoked, not expired), newest first. */
export async function listMyConnections(
  db: Pick<SupabaseClient, "from">,
  now: Date = new Date(),
): Promise<McpConnection[]> {
  const { data, error } = await db
    .from("mcp_connections")
    .select("id, client_id, name, scope, created_at, last_used_at, expires_at")
    .is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`)
    .order("created_at", { ascending: false });
  if (error) throw new McpConnectionError("PAGE_ACTION_FAILED", { cause: error });
  return z
    .array(rowSchema)
    .parse(data ?? [])
    .map((row) => ({
      id: row.id,
      kind: row.client_id ? "assistant" : "personal",
      name: row.name,
      scope: row.scope,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      expiresAt: row.expires_at,
    }));
}

/** Revokes one of the caller's connections; its tokens stop working at once. */
export async function revokeMyConnection(
  db: Pick<SupabaseClient, "from">,
  connectionId: string,
): Promise<void> {
  if (!z.guid().safeParse(connectionId).success) throw new McpConnectionError("VALIDATION_FAILED");
  const { data, error } = await db
    .from("mcp_connections")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", connectionId)
    .is("revoked_at", null)
    .select("id");
  if (error) throw new McpConnectionError("PAGE_ACTION_FAILED", { cause: error });
  if (!data || data.length === 0) throw new McpConnectionError("FORBIDDEN");
}
