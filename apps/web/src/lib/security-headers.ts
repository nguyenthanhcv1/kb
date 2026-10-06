/**
 * HTTP security headers of kb-web (task T7.2, runbook docs/runbooks/security.md).
 *
 * Two layers:
 *  - {@link STATIC_SECURITY_HEADERS}: the same on every response (pages, API, static assets) —
 *    set from `next.config.ts` `headers()`.
 *  - {@link contentSecurityPolicy}: depends on runtime settings (Supabase URL, collab URL are not
 *    known at build time, see lib/env.ts) — set by the middleware on every page response.
 *
 * CSP keeps `'unsafe-inline'` for scripts and styles: the App Router streams its RSC payload in
 * inline `<script>` tags, next-themes injects its no-flash script, and TipTap/Radix set inline
 * styles. Images may come from any HTTPS host (profile pictures are external URLs). Everything else
 * is locked to the app's own origin plus the two backends it talks to.
 */

export interface SecurityHeader {
  key: string;
  value: string;
}

/** Two years, as required for the HSTS preload list; Cloudflare terminates TLS in front. */
const HSTS_MAX_AGE_SECONDS = 63_072_000;

export const STATIC_SECURITY_HEADERS: readonly SecurityHeader[] = [
  { key: "Strict-Transport-Security", value: `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains` },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

/** Google OAuth consent screen (Supabase Auth's only provider, docs/PLAN.md §5). */
const GOOGLE_ACCOUNTS_ORIGIN = "https://accounts.google.com";

export interface CspOptions {
  /** `SUPABASE_URL` — REST/Auth/Storage over HTTPS, Realtime over WSS. */
  supabaseUrl: string;
  /** `COLLAB_PUBLIC_URL` (ws:// or wss://), when real-time editing is configured. */
  collabUrl?: string | undefined;
  /** Local `next dev` needs `eval` for React Refresh and an insecure websocket for HMR. */
  dev?: boolean;
  /** Behind HTTPS (preview/staging/production): browsers upgrade any stray http:// subresource. */
  upgradeInsecureRequests?: boolean;
}

/** `https://host` → `wss://host` (and http → ws) so Supabase Realtime is allowed too. */
function websocketOrigin(origin: string): string {
  return origin.replace(/^http(s?):/, "ws$1:");
}

function origin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Content-Security-Policy value for page responses. */
export function contentSecurityPolicy({
  supabaseUrl,
  collabUrl,
  dev = false,
  upgradeInsecureRequests = false,
}: CspOptions): string {
  const supabase = origin(supabaseUrl);
  const collab = origin(collabUrl);

  const connect = new Set(["'self'"]);
  if (supabase) {
    connect.add(supabase);
    connect.add(websocketOrigin(supabase));
  }
  if (collab) connect.add(collab);
  if (dev) connect.add("ws:");

  // Profile pictures are external URLs: the Google account picture (lh3.googleusercontent.com) or
  // any http(s) link a user pastes in Settings. Images cannot run code, so any HTTPS host is allowed
  // (http:// links are upgraded behind HTTPS); plain http only in local dev.
  const images = [
    "'self'",
    "data:",
    "blob:",
    "https:",
    ...(dev ? ["http:"] : []),
    ...(supabase ? [supabase] : []),
  ];
  const scripts = ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])];

  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    ["script-src", ...scripts],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", ...images],
    ["font-src", "'self'", "data:"],
    ["connect-src", ...connect],
    ["media-src", "'self'", "blob:", ...(supabase ? [supabase] : [])],
    ["worker-src", "'self'", "blob:"],
    ["frame-src", "'none'"],
    ["frame-ancestors", "'none'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    // The login form's server action redirects to Supabase Auth, which redirects to Google; without
    // JS that is a native form submission, and browsers apply form-action to every redirect hop.
    ["form-action", "'self'", ...(supabase ? [supabase] : []), GOOGLE_ACCOUNTS_ORIGIN],
    ["manifest-src", "'self'"],
  ];
  if (upgradeInsecureRequests) directives.push(["upgrade-insecure-requests"]);

  return directives.map((d) => d.join(" ")).join("; ");
}
