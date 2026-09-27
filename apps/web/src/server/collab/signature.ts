import { createHash, createHmac, randomBytes } from "node:crypto";

/**
 * HMAC signing of kb-web → kb-collab internal API requests, format v1. Mirror of
 * `apps/collab/src/internal-signature.ts` (which verifies it); both test files pin the same test
 * vector, so a change on one side without the other fails CI.
 *
 *   canonical = "v1\n" + timestamp + "\n" + nonce + "\n" + METHOD + "\n" + path + "\n"
 *               + hex(SHA-256(body))
 *   x-kb-signature: v1=<hex HMAC-SHA256(COLLAB_INTERNAL_SECRET, canonical)>
 */

export const TIMESTAMP_HEADER = "x-kb-timestamp";
export const NONCE_HEADER = "x-kb-nonce";
export const SIGNATURE_HEADER = "x-kb-signature";

export interface SignatureInput {
  method: string;
  /** Path and query exactly as sent, e.g. `/internal/documents/<id>/replace`. */
  path: string;
  body: string;
  /** Unix seconds. */
  timestamp: number;
  nonce: string;
}

export function computeSignature(secret: string, input: SignatureInput): string {
  const bodyHash = createHash("sha256").update(input.body).digest("hex");
  const canonical = [
    "v1",
    input.timestamp,
    input.nonce,
    input.method.toUpperCase(),
    input.path,
    bodyHash,
  ].join("\n");
  return `v1=${createHmac("sha256", secret).update(canonical).digest("hex")}`;
}

/** Timestamp, single-use nonce and signature headers for one request. */
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
