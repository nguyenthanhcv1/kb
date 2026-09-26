import { describe, expect, it } from "vitest";

import {
  computeSignature,
  NONCE_HEADER,
  SIGNATURE_HEADER,
  signRequest,
  TIMESTAMP_HEADER,
} from "./signature";

describe("collab internal API signature", () => {
  it("matches the v1 test vector shared with kb-collab", () => {
    // Same vector in apps/collab/src/internal-signature.test.ts.
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

  it("signs with the current time and a fresh nonce", () => {
    const now = Date.UTC(2026, 8, 26);
    const first = signRequest("s", { method: "POST", path: "/x", body: "" }, now);
    const second = signRequest("s", { method: "POST", path: "/x", body: "" }, now);
    expect(first[TIMESTAMP_HEADER]).toBe(String(now / 1000));
    expect(first[NONCE_HEADER]).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(first[NONCE_HEADER]).not.toBe(second[NONCE_HEADER]);
    expect(first[SIGNATURE_HEADER]).toBe(
      computeSignature("s", {
        method: "POST",
        path: "/x",
        body: "",
        timestamp: now / 1000,
        nonce: first[NONCE_HEADER]!,
      }),
    );
  });
});
