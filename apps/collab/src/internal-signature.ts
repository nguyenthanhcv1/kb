import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Request signing for the kb-web → kb-collab internal API (docs/PLAN.md §1.2, task T3.7).
 *
 * Format v1 (kb-web implements the same in `apps/web/src/server/collab/signature.ts`; both test
 * files pin the same test vector):
 *
 *   x-kb-timestamp: <unix seconds>
 *   x-kb-nonce:     <16–128 chars of [A-Za-z0-9_-]>
 *   x-kb-signature: v1=<hex HMAC-SHA256(COLLAB_INTERNAL_SECRET, canonical)>
 *
 *   canonical = "v1\n" + timestamp + "\n" + nonce + "\n" + METHOD + "\n" + path + "\n"
 *               + hex(SHA-256(raw body))
 *
 * The signature covers method, path (with query) and body, so a captured request cannot be
 * re-targeted to another page or given another body. Timestamps outside ±{@link
 * SIGNATURE_MAX_AGE_SECONDS} are refused and a nonce is accepted once within that window, so a
 * captured request cannot be replayed either.
 */

export const SIGNATURE_VERSION = "v1";
export const TIMESTAMP_HEADER = "x-kb-timestamp";
export const NONCE_HEADER = "x-kb-nonce";
export const SIGNATURE_HEADER = "x-kb-signature";

/** Allowed clock difference between kb-web and kb-collab (same host / network in production). */
export const SIGNATURE_MAX_AGE_SECONDS = 60;

const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
const TIMESTAMP = /^\d{1,12}$/;
const SIGNATURE = /^v1=([0-9a-f]{64})$/;
/** Upper bound of remembered nonces; beyond it requests are refused until old ones expire. */
const MAX_NONCES = 100_000;

export interface SignatureInput {
  method: string;
  /** Path and query as sent on the request line, e.g. `/internal/documents/<id>/replace`. */
  path: string;
  body: Uint8Array | string;
  timestamp: number;
  nonce: string;
}

export function canonicalRequest({ method, path, body, timestamp, nonce }: SignatureInput): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return [SIGNATURE_VERSION, timestamp, nonce, method.toUpperCase(), path, bodyHash].join("\n");
}

export function computeSignature(secret: string, input: SignatureInput): string {
  const mac = createHmac("sha256", secret).update(canonicalRequest(input)).digest("hex");
  return `${SIGNATURE_VERSION}=${mac}`;
}

/** Headers for a signed request (used by tests; kb-web has its own copy). */
export function signRequest(
  secret: string,
  request: Pick<SignatureInput, "method" | "path" | "body">,
  now: number = Date.now(),
): Record<string, string> {
  const timestamp = Math.floor(now / 1000);
  const nonce = randomBytes(18).toString("base64url");
  return {
    [TIMESTAMP_HEADER]: String(timestamp),
    [NONCE_HEADER]: nonce,
    [SIGNATURE_HEADER]: computeSignature(secret, { ...request, timestamp, nonce }),
  };
}

export type SignatureFailure =
  "MISSING_HEADERS" | "MALFORMED_HEADERS" | "EXPIRED" | "BAD_SIGNATURE" | "REPLAYED";

export type SignatureResult = { ok: true } | { ok: false; failure: SignatureFailure };

export interface SignatureVerifier {
  verify(request: {
    method: string;
    path: string;
    body: Uint8Array;
    headers: Record<string, string | string[] | undefined>;
  }): SignatureResult;
}

function header(headers: Record<string, string | string[] | undefined>, name: string) {
  const value = headers[name];
  return Array.isArray(value) ? undefined : value;
}

/**
 * Verifier with an in-memory nonce cache (one kb-collab replica at MVP; a Redis-backed cache is
 * needed once collab scales out, docs/PLAN.md §8).
 */
export function createSignatureVerifier(
  secret: string,
  options: { now?: () => number; maxAgeSeconds?: number } = {},
): SignatureVerifier {
  const now = options.now ?? Date.now;
  const maxAge = options.maxAgeSeconds ?? SIGNATURE_MAX_AGE_SECONDS;
  const seen = new Map<string, number>();

  function prune(nowMs: number) {
    for (const [nonce, expiresAt] of seen) if (expiresAt <= nowMs) seen.delete(nonce);
  }

  return {
    verify({ method, path, body, headers }) {
      const timestamp = header(headers, TIMESTAMP_HEADER);
      const nonce = header(headers, NONCE_HEADER);
      const signature = header(headers, SIGNATURE_HEADER);
      if (!timestamp || !nonce || !signature) return { ok: false, failure: "MISSING_HEADERS" };

      const match = SIGNATURE.exec(signature);
      if (!TIMESTAMP.test(timestamp) || !NONCE.test(nonce) || !match) {
        return { ok: false, failure: "MALFORMED_HEADERS" };
      }

      const nowMs = now();
      const seconds = Number(timestamp);
      if (Math.abs(nowMs / 1000 - seconds) > maxAge) return { ok: false, failure: "EXPIRED" };

      const expected = Buffer.from(
        computeSignature(secret, { method, path, body, timestamp: seconds, nonce }).slice(3),
        "hex",
      );
      if (!timingSafeEqual(expected, Buffer.from(match[1]!, "hex"))) {
        return { ok: false, failure: "BAD_SIGNATURE" };
      }

      // Only authentic requests reach the cache, so it cannot be flooded from outside.
      prune(nowMs);
      if (seen.has(nonce) || seen.size >= MAX_NONCES) return { ok: false, failure: "REPLAYED" };
      seen.set(nonce, (seconds + maxAge) * 1000 + 1);
      return { ok: true };
    },
  };
}
