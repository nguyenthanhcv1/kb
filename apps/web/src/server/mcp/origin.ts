import { headers } from "next/headers";

import { publicOrigin } from "@/lib/public-origin";

/**
 * Public origin of the current request in Server Components / Actions (APP_URL when deployed,
 * else the Host header) — the OAuth issuer and the base of the MCP server address.
 */
export async function mcpRequestOrigin(): Promise<string> {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "localhost:3000";
  const proto = list.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return publicOrigin(`${proto}://${host}/`);
}
