/** Client-safe constants of the MCP connector (no Node APIs: imported by Settings UI). */

export const MCP_SCOPES = ["read", "write"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

/** Lifetimes offered for personal tokens in Settings. */
export const PERSONAL_TOKEN_TTL_DAYS = [30, 90, 365] as const;
export type PersonalTokenTtlDays = (typeof PERSONAL_TOKEN_TTL_DAYS)[number];
