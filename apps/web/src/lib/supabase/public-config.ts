/**
 * Supabase settings the browser needs (public URL + anon key — both public by design).
 *
 * `NEXT_PUBLIC_*` variables are inlined into the browser bundle **at build time**, but the Docker
 * image is built once in CI without them and gets them only when the container starts (Coolify).
 * So the root layout reads them on the server at request time and hands them to the browser
 * through a tiny inline script; {@link readPublicSupabaseConfig} prefers that, and falls back to
 * the build-time values (`next dev`, tests).
 */
export type PublicSupabaseConfig = { url: string; anonKey: string };

declare global {
  interface Window {
    __KB_SUPABASE__?: PublicSupabaseConfig;
  }
}

/** Body of the inline `<script>` of the root layout (`<` escaped so it cannot close the tag). */
export function publicSupabaseConfigScript(config: PublicSupabaseConfig): string {
  return `window.__KB_SUPABASE__=${JSON.stringify(config).replace(/</g, "\\u003c")};`;
}

/** Runtime settings from the layout script, else the build-time `NEXT_PUBLIC_*` values. */
export function readPublicSupabaseConfig(): PublicSupabaseConfig | null {
  const injected = typeof window === "undefined" ? undefined : window.__KB_SUPABASE__;
  if (injected?.url && injected.anonKey) return injected;
  // Literal `process.env.X` so Next.js can inline them when they exist at build time.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}
