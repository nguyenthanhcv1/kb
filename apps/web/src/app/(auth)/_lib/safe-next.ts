/**
 * Path to return to after sign-in. Only same-origin absolute paths are kept
 * (`/s/eng/p/abc?x=1`); anything else (`https://evil.test`, `//evil.test`, `/\evil`) → `/`.
 * Shared with the OAuth callback (T1.2a) to block open redirects.
 */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  // Control characters (tab, newline) are stripped by URL parsers and can smuggle a host.
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return "/";
  }
  return value;
}
