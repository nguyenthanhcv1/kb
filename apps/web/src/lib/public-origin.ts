/**
 * Origin the browser sees, for absolute redirects. Behind a reverse proxy (Traefik on Coolify)
 * `request.url` of the standalone server is its bind address (`http://0.0.0.0:3000`), so a
 * redirect built from it sends the user nowhere. `APP_URL` (required when deployed, see
 * `lib/env.ts`) wins; without it (local dev) the request origin is right. Edge-safe: no Node APIs.
 */
export function publicOrigin(requestUrl: string, appUrl = process.env.APP_URL): string {
  if (appUrl) return new URL(appUrl).origin;
  return new URL(requestUrl).origin;
}
