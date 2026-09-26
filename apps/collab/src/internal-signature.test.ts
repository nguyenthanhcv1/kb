import { describe, expect, it } from "vitest";

import {
  computeSignature,
  createSignatureVerifier,
  NONCE_HEADER,
  SIGNATURE_HEADER,
  signRequest,
  TIMESTAMP_HEADER,
} from "./internal-signature";

const SECRET = "internal-secret-0123456789-0123456789";
const PATH = "/internal/documents/7b0c2a4e-1f5d-4c3b-9a8e-2d6f1b3c5a7e/replace";
const BODY = '{"content":{"type":"doc"},"actorId":"00000000-0000-4000-8000-000000000001"}';
const NOW = Date.UTC(2026, 8, 26, 3, 0, 0);

const request = (
  headers: Record<string, string>,
  overrides: Partial<{ method: string; path: string; body: string }> = {},
) => ({
  method: overrides.method ?? "POST",
  path: overrides.path ?? PATH,
  body: new TextEncoder().encode(overrides.body ?? BODY),
  headers,
});

describe("internal API signature", () => {
  it("matches the v1 test vector shared with kb-web", () => {
    // Same vector in apps/web/src/server/collab/signature.test.ts.
    expect(
      computeSignature("test-secret", {
        method: "post",
        path: "/internal/documents/00000000-0000-4000-8000-000000000000/replace",
        body: '{"hello":"world"}',
        timestamp: 1_790_000_000,
        nonce: "nonce-0123456789abcdef",
      }),
    ).toBe("v1=2b47fbb62f977da04c3eda8126d69a607d3c2b151609e01d35a979e4c3e63371");
  });

  it("accepts a correctly signed request once", () => {
    const verifier = createSignatureVerifier(SECRET, { now: () => NOW });
    const headers = signRequest(SECRET, { method: "POST", path: PATH, body: BODY }, NOW);
    expect(verifier.verify(request(headers))).toEqual({ ok: true });
    expect(verifier.verify(request(headers))).toEqual({ ok: false, failure: "REPLAYED" });
  });

  it("rejects a signature made with another secret", () => {
    const verifier = createSignatureVerifier(SECRET, { now: () => NOW });
    const headers = signRequest(
      "another-secret-0123456789-0123456789",
      { method: "POST", path: PATH, body: BODY },
      NOW,
    );
    expect(verifier.verify(request(headers))).toEqual({ ok: false, failure: "BAD_SIGNATURE" });
  });

  it("rejects a changed body, path or method", () => {
    const verifier = createSignatureVerifier(SECRET, { now: () => NOW });
    const headers = signRequest(SECRET, { method: "POST", path: PATH, body: BODY }, NOW);
    expect(verifier.verify(request(headers, { body: BODY.replace("doc", "paragraph") }))).toEqual({
      ok: false,
      failure: "BAD_SIGNATURE",
    });
    expect(verifier.verify(request(headers, { path: PATH.replace("7b0c", "0000") }))).toEqual({
      ok: false,
      failure: "BAD_SIGNATURE",
    });
    expect(verifier.verify(request(headers, { method: "PUT" }))).toEqual({
      ok: false,
      failure: "BAD_SIGNATURE",
    });
    // The failed attempts did not burn the nonce.
    expect(verifier.verify(request(headers))).toEqual({ ok: true });
  });

  it("rejects timestamps outside the window, in both directions", () => {
    const verifier = createSignatureVerifier(SECRET, { now: () => NOW });
    const old = signRequest(SECRET, { method: "POST", path: PATH, body: BODY }, NOW - 61_000);
    const future = signRequest(SECRET, { method: "POST", path: PATH, body: BODY }, NOW + 61_000);
    const skewed = signRequest(SECRET, { method: "POST", path: PATH, body: BODY }, NOW - 59_000);
    expect(verifier.verify(request(old))).toEqual({ ok: false, failure: "EXPIRED" });
    expect(verifier.verify(request(future))).toEqual({ ok: false, failure: "EXPIRED" });
    expect(verifier.verify(request(skewed))).toEqual({ ok: true });
  });

  it("forgets nonces only after their timestamp has expired", () => {
    let now = NOW;
    const verifier = createSignatureVerifier(SECRET, { now: () => now });
    const headers = signRequest(SECRET, { method: "POST", path: PATH, body: BODY }, NOW);
    expect(verifier.verify(request(headers)).ok).toBe(true);
    now = NOW + 30_000;
    expect(verifier.verify(request(headers))).toEqual({ ok: false, failure: "REPLAYED" });
    now = NOW + 61_000;
    expect(verifier.verify(request(headers))).toEqual({ ok: false, failure: "EXPIRED" });
  });

  it("rejects missing or malformed headers", () => {
    const verifier = createSignatureVerifier(SECRET, { now: () => NOW });
    const headers = signRequest(SECRET, { method: "POST", path: PATH, body: BODY }, NOW);
    expect(verifier.verify(request({}))).toEqual({ ok: false, failure: "MISSING_HEADERS" });
    expect(verifier.verify(request({ ...headers, [SIGNATURE_HEADER]: "" }))).toEqual({
      ok: false,
      failure: "MISSING_HEADERS",
    });
    expect(
      verifier.verify(
        request({ ...headers, [SIGNATURE_HEADER]: headers[SIGNATURE_HEADER]!.slice(3) }),
      ),
    ).toEqual({ ok: false, failure: "MALFORMED_HEADERS" });
    expect(verifier.verify(request({ ...headers, [NONCE_HEADER]: "short" }))).toEqual({
      ok: false,
      failure: "MALFORMED_HEADERS",
    });
    expect(verifier.verify(request({ ...headers, [TIMESTAMP_HEADER]: "1e9" }))).toEqual({
      ok: false,
      failure: "MALFORMED_HEADERS",
    });
  });
});
