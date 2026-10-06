"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import {
  listMyConnections,
  type McpConnection,
  McpConnectionError,
  type McpErrorCode,
  revokeMyConnection,
} from "./connections";
import {
  approveAuthorization,
  authorizeErrorRedirect,
  type CreatePersonalTokenInput,
  createPersonalToken,
  createPersonalTokenInputSchema,
  getClient,
  OAuthError,
} from "./oauth";
import type { McpScope } from "./constants";
import { mcpRequestOrigin } from "./origin";
import { isUserClientConfigured } from "./user-client";

/**
 * Server Actions of Settings › AI assistants and of the OAuth consent screen. Results are plain
 * objects with an error code (`errors.<code>`), never thrown errors.
 */
export type McpActionResult<T> = { ok: true; data: T } | { ok: false; error: McpErrorCode };

async function requireUserId(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new McpConnectionError("UNAUTHORIZED");
  return { supabase, userId: data.user.id };
}

async function run<T>(action: () => Promise<T>): Promise<McpActionResult<T>> {
  try {
    return { ok: true, data: await action() };
  } catch (error) {
    if (error instanceof McpConnectionError) return { ok: false, error: error.code };
    if (error instanceof OAuthError && error.description === "MCP_CONNECTION_LIMIT") {
      return { ok: false, error: "MCP_CONNECTION_LIMIT" };
    }
    console.error("[mcp] action failed", error);
    return { ok: false, error: "PAGE_ACTION_FAILED" };
  }
}

export async function listMyConnectionsAction(): Promise<McpActionResult<McpConnection[]>> {
  return run(async () => {
    const { supabase } = await requireUserId();
    return listMyConnections(supabase);
  });
}

export async function revokeConnectionAction(connectionId: string): Promise<McpActionResult<null>> {
  return run(async () => {
    const { supabase } = await requireUserId();
    await revokeMyConnection(supabase, connectionId);
    return null;
  });
}

/** Creates a personal token; the raw token is returned once and never stored. */
export async function createPersonalTokenAction(
  input: CreatePersonalTokenInput,
): Promise<McpActionResult<{ token: string; expiresAt: string }>> {
  return run(async () => {
    const { userId } = await requireUserId();
    const parsed = createPersonalTokenInputSchema.safeParse(input);
    if (!parsed.success) throw new McpConnectionError("VALIDATION_FAILED");
    if (!isUserClientConfigured()) throw new McpConnectionError("MCP_NOT_CONFIGURED");
    const { token, expiresAt } = await createPersonalToken(
      createAdminClient(),
      userId,
      parsed.data,
    );
    return { token, expiresAt };
  });
}

export interface ConsentDecision {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  scope: McpScope;
}

/**
 * Consent screen "Allow": returns the URL to send the browser to (the client's redirect URI
 * with a code). The client navigates itself — a cross-origin redirect from a form POST would be
 * blocked by CSP `form-action`.
 */
export async function approveAuthorizationAction(
  decision: ConsentDecision,
): Promise<McpActionResult<{ redirectTo: string }>> {
  return run(async () => {
    const { userId } = await requireUserId();
    const redirectTo = await approveAuthorization(createAdminClient(), {
      userId,
      clientId: decision.clientId,
      redirectUri: decision.redirectUri,
      codeChallenge: decision.codeChallenge,
      state: decision.state,
      scope: decision.scope === "read" ? "read" : "write",
      issuer: await mcpRequestOrigin(),
    }).catch((error: unknown) => {
      if (error instanceof OAuthError && error.error === "invalid_client") {
        throw new McpConnectionError("VALIDATION_FAILED");
      }
      throw error;
    });
    return { redirectTo };
  });
}

/** Consent screen "Deny": the client gets `error=access_denied`. */
export async function denyAuthorizationAction(
  decision: Pick<ConsentDecision, "clientId" | "redirectUri" | "state">,
): Promise<McpActionResult<{ redirectTo: string }>> {
  return run(async () => {
    await requireUserId();
    const client = await getClient(createAdminClient(), decision.clientId);
    if (!client || !client.redirectUris.includes(decision.redirectUri)) {
      throw new McpConnectionError("VALIDATION_FAILED");
    }
    return {
      redirectTo: authorizeErrorRedirect(
        decision.redirectUri,
        "access_denied",
        decision.state,
        await mcpRequestOrigin(),
      ),
    };
  });
}
