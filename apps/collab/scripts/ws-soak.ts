/**
 * WebSocket soak test for kb-collab (spike T0.10 — docs/runbooks/spike-t0.10.md §b).
 *
 * Opens ONE real Hocuspocus connection (same provider library and defaults the web editor uses:
 * awareness on, reconnect with exponential backoff 1 s → 30 s) to `page:<uuid>`, keeps it idle
 * for `--minutes`, logs every connect/disconnect as a JSON line and exits
 *   0 — authenticated, still connected at the end, ≤ --max-disconnects disconnects
 *   1 — the connection dropped (more than allowed) or was down at the end
 *   2 — bad arguments or authentication failed (token/origin/page/schemaVersion)
 *
 *   KB_SOAK_TOKEN=<access token> pnpm --filter @kb/collab soak -- \
 *     --url wss://kb-staging-collab.thanhgo.com --page <uuid> --origin https://kb-staging.thanhgo.com
 *
 * The token is read from KB_SOAK_TOKEN so it does not end up in shell history. It is a Supabase
 * access token (1 h by default): the run must end before it expires — a reconnect after expiry
 * fails authentication, which this script reports as exit 2.
 */
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { EDITOR_SCHEMA_VERSION } from "@kb/editor/schema-version";
import WebSocket from "ws";
import * as Y from "yjs";

import {
  parseSoakArgs,
  type SoakEvent,
  type SoakOptions,
  summarize,
  tokenExpiresAt,
  USAGE,
} from "./ws-soak-lib";

function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), ...fields }));
}

let options: SoakOptions;
try {
  options = parseSoakArgs(process.argv.slice(2), process.env);
} catch (error) {
  console.error(`${(error as Error).message}\n\n${USAGE}`);
  process.exit(2);
}

const startedAt = Date.now();
const endsAt = startedAt + options.minutes * 60_000;
const expiresAt = tokenExpiresAt(options.token);
if (expiresAt !== null && expiresAt < endsAt) {
  log({
    level: "warn",
    msg: "access token expires before the run ends; reconnects after that will fail",
    tokenExpiresAt: new Date(expiresAt).toISOString(),
  });
}

/** `ws` lets us send the Origin header that kb-collab checks against ALLOWED_ORIGINS. */
const origin = options.origin;
class OriginWebSocket extends WebSocket {
  constructor(address: string | URL, protocols?: string | string[]) {
    super(address, protocols, origin ? { origin } : {});
  }
}

const events: SoakEvent[] = [];
let messages = 0;

const websocketProvider = new HocuspocusProviderWebsocket({
  url: `${options.url}?schemaVersion=${EDITOR_SCHEMA_VERSION}`,
  WebSocketPolyfill: OriginWebSocket as unknown as typeof globalThis.WebSocket,
  onConnect: () => {
    events.push({ type: "connect", at: Date.now() });
    log({ event: "connect" });
  },
  onDisconnect: ({ event }) => {
    events.push({ type: "disconnect", at: Date.now(), code: event?.code, reason: event?.reason });
    log({ event: "disconnect", code: event?.code, reason: event?.reason || undefined });
  },
  onMessage: () => {
    messages += 1;
  },
});

const provider = new HocuspocusProvider({
  name: `page:${options.pageId}`,
  document: new Y.Doc(),
  token: options.token,
  websocketProvider,
  // null = no awareness → no periodic messages (the server then closes an idle client after 60 s).
  ...(options.awareness ? {} : { awareness: null }),
  onAuthenticated: ({ scope }) => {
    events.push({ type: "authenticated", at: Date.now() });
    log({ event: "authenticated", scope });
  },
  onAuthenticationFailed: ({ reason }) => {
    events.push({ type: "authenticationFailed", at: Date.now(), reason });
    log({ level: "error", event: "authenticationFailed", reason });
    finish();
  },
  onSynced: () => log({ event: "synced" }),
});
provider.attach();
provider.awareness?.setLocalStateField("user", { name: "ws-soak" });

log({
  msg: "soak started",
  url: options.url,
  document: `page:${options.pageId}`,
  minutes: options.minutes,
  awareness: options.awareness,
});

const heartbeat = setInterval(() => {
  log({
    event: "heartbeat",
    elapsedMin: Math.round((Date.now() - startedAt) / 600) / 100,
    status: websocketProvider.status,
    messagesReceived: messages,
    disconnects: events.filter((event) => event.type === "disconnect").length,
  });
}, options.heartbeatSeconds * 1000);

const timer = setTimeout(finish, endsAt - Date.now());
process.once("SIGINT", finish);

let finished = false;
function finish(): void {
  if (finished) return;
  finished = true;
  clearInterval(heartbeat);
  clearTimeout(timer);
  const summary = summarize(events, startedAt, Date.now(), options.maxDisconnects);
  log({ msg: "soak finished", messagesReceived: messages, ...summary });
  provider.destroy();
  websocketProvider.destroy();
  process.exit(summary.authenticationFailed !== null ? 2 : summary.passed ? 0 : 1);
}
