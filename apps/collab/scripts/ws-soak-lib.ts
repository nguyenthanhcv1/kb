/**
 * Pure helpers behind `scripts/ws-soak.ts` (spike T0.10, docs/adr/0003-websocket-cloudflare-traefik-jwt.md).
 * No I/O here, so every rule the soak test reports on is unit-tested.
 */
import { parseArgs } from "node:util";

export interface SoakOptions {
  /** wss://kb-staging-collab.thanhgo.com (no path, no query). */
  url: string;
  /** Page UUID; the document name is `page:<uuid>`. */
  pageId: string;
  /** Supabase access token (raw JWT, or the `sb-…-auth-token` cookie value). */
  token: string;
  /** Sent as the Origin header; must match the collab `ALLOWED_ORIGINS`. */
  origin: string | undefined;
  minutes: number;
  /** Disconnects tolerated before the run counts as failed (default 0). */
  maxDisconnects: number;
  /** false = no awareness → no periodic traffic (shows what an idle client without keepalive does). */
  awareness: boolean;
  /** Log a heartbeat line every N seconds. */
  heartbeatSeconds: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const USAGE = `Usage: KB_SOAK_TOKEN=<access token> pnpm --filter @kb/collab soak -- \\
  --url wss://kb-staging-collab.thanhgo.com --page <page uuid> \\
  [--origin https://kb-staging.thanhgo.com] [--minutes 35] [--max-disconnects 0] \\
  [--no-awareness] [--heartbeat 60] [--token <jwt or sb-…-auth-token cookie value>]`;

/** Parses argv (without `node script`). Throws an Error with a readable message on bad input. */
export function parseSoakArgs(
  argv: string[],
  env: Record<string, string | undefined> = {},
): SoakOptions {
  const { values } = parseArgs({
    args: argv.filter((arg) => arg !== "--"),
    options: {
      url: { type: "string" },
      page: { type: "string" },
      token: { type: "string" },
      origin: { type: "string" },
      minutes: { type: "string", default: "35" },
      "max-disconnects": { type: "string", default: "0" },
      "no-awareness": { type: "boolean", default: false },
      heartbeat: { type: "string", default: "60" },
    },
    strict: true,
  });

  const url = values.url ?? env.KB_SOAK_URL;
  if (!url || !/^wss?:\/\/[^/?#]+\/?$/.test(url)) {
    throw new Error("--url must be ws:// or wss:// with a host and no path/query");
  }
  const pageId = values.page ?? env.KB_SOAK_PAGE;
  if (!pageId || !UUID.test(pageId)) throw new Error("--page must be a page UUID");
  const tokenInput = values.token ?? env.KB_SOAK_TOKEN;
  if (!tokenInput) throw new Error("set KB_SOAK_TOKEN (or --token) to a Supabase access token");
  const token = extractAccessToken(tokenInput);

  const minutes = Number(values.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("--minutes must be > 0");
  const maxDisconnects = Number(values["max-disconnects"]);
  if (!Number.isInteger(maxDisconnects) || maxDisconnects < 0) {
    throw new Error("--max-disconnects must be an integer ≥ 0");
  }
  const heartbeatSeconds = Number(values.heartbeat);
  if (!Number.isFinite(heartbeatSeconds) || heartbeatSeconds <= 0) {
    throw new Error("--heartbeat must be > 0");
  }

  return {
    url: url.replace(/\/$/, ""),
    pageId: pageId.toLowerCase(),
    token,
    origin: values.origin ?? env.KB_SOAK_ORIGIN,
    minutes,
    maxDisconnects,
    awareness: !values["no-awareness"],
    heartbeatSeconds,
  };
}

const JWT = /^[\w-]+\.[\w-]+\.[\w-]+$/;

/**
 * Accepts a raw JWT, or the value of the `sb-<ref>-auth-token` cookie that `@supabase/ssr` sets
 * (`base64-<base64url JSON>` or plain JSON with `access_token`). Chunked cookies (`….0`, `….1`)
 * must be concatenated first.
 */
export function extractAccessToken(input: string): string {
  const value = input.trim();
  if (JWT.test(value)) return value;
  let json = value;
  if (value.startsWith("base64-")) {
    json = Buffer.from(value.slice("base64-".length), "base64url").toString("utf8");
  } else if (value.startsWith("%7B")) {
    json = decodeURIComponent(value);
  }
  try {
    const parsed: unknown = JSON.parse(json);
    const token =
      parsed && typeof parsed === "object" && "access_token" in parsed
        ? (parsed as { access_token: unknown }).access_token
        : undefined;
    if (typeof token === "string" && JWT.test(token)) return token;
  } catch {
    // fall through
  }
  throw new Error("token is neither a JWT nor a Supabase auth cookie with access_token");
}

/** `exp` of a JWT in ms since epoch, without verifying it (only to warn before a long run). */
export function tokenExpiresAt(token: string): number | null {
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    );
    const exp = (payload as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export type SoakEvent =
  | { type: "connect"; at: number }
  | { type: "disconnect"; at: number; code?: number; reason?: string }
  | { type: "authenticated"; at: number }
  | { type: "authenticationFailed"; at: number; reason: string };

export interface SoakSummary {
  durationMs: number;
  connects: number;
  disconnects: number;
  /** Longest stretch between a connect and the next disconnect (or the end of the run). */
  longestConnectedMs: number;
  connectedAtEnd: boolean;
  authenticationFailed: string | null;
  disconnectLog: { atMs: number; code?: number; reason?: string }[];
  passed: boolean;
}

/**
 * Summarizes a run. Passes when authentication succeeded, the connection is up at the end, and
 * there were at most `maxDisconnects` disconnects. With `maxDisconnects = 0` that means one
 * uninterrupted connection for the whole run (the T0.10 criterion: ≥ 30 min through Cloudflare).
 */
export function summarize(
  events: SoakEvent[],
  startedAt: number,
  endedAt: number,
  maxDisconnects: number,
): SoakSummary {
  let connects = 0;
  let longest = 0;
  let upSince: number | null = null;
  let authenticationFailed: string | null = null;
  const disconnectLog: SoakSummary["disconnectLog"] = [];

  for (const event of [...events].sort((a, b) => a.at - b.at)) {
    if (event.type === "connect") {
      connects += 1;
      upSince ??= event.at;
    } else if (event.type === "disconnect") {
      if (upSince !== null) longest = Math.max(longest, event.at - upSince);
      upSince = null;
      disconnectLog.push({ atMs: event.at - startedAt, code: event.code, reason: event.reason });
    } else if (event.type === "authenticationFailed") {
      authenticationFailed = event.reason;
    }
  }
  if (upSince !== null) longest = Math.max(longest, endedAt - upSince);

  const connectedAtEnd = upSince !== null;
  const authenticated = events.some((event) => event.type === "authenticated");
  return {
    durationMs: endedAt - startedAt,
    connects,
    disconnects: disconnectLog.length,
    longestConnectedMs: longest,
    connectedAtEnd,
    authenticationFailed,
    disconnectLog,
    passed:
      authenticated &&
      authenticationFailed === null &&
      connectedAtEnd &&
      disconnectLog.length <= maxDisconnects,
  };
}
