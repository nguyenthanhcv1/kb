import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CollabError, createPageVersion, replaceDocument } from "./index";
import { computeSignature, NONCE_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./signature";

const SECRET = "web-collab-client-secret-0123456789-abc";
const PAGE_ID = "7b0c2a4e-1f5d-4c3b-9a8e-2d6f1b3c5a7e";
const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const content = {
  type: "doc" as const,
  content: [{ type: "paragraph", content: [{ type: "text", text: "Xin chào" }] }],
};

interface Received {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

let server: Server | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
  server = undefined;
});

/** Fake kb-collab answering every request with `status` / `reply`. */
async function fakeCollab(status: number, reply: unknown) {
  const received: Received[] = [];
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    received.push({
      method: request.method!,
      url: request.url!,
      headers: request.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    });
    response.writeHead(status, { "content-type": "application/json" });
    response.end(typeof reply === "string" ? reply : JSON.stringify(reply));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  return { url, received };
}

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(CollabError);
  const { code, reason } = error as CollabError;
  return { code, reason };
}

describe("replaceDocument", () => {
  it("posts a signed request and returns collab's result", async () => {
    const { url, received } = await fakeCollab(200, {
      pageId: PAGE_ID,
      schemaVersion: 1,
      connections: 2,
    });

    await expect(
      replaceDocument(
        { pageId: PAGE_ID, content, actorId: ACTOR_ID, reason: "restore" },
        { url, secret: SECRET },
      ),
    ).resolves.toEqual({ pageId: PAGE_ID, schemaVersion: 1, connections: 2 });

    expect(received).toHaveLength(1);
    const [request] = received;
    expect(request!.method).toBe("POST");
    expect(request!.url).toBe(`/internal/documents/${PAGE_ID}/replace`);
    expect(JSON.parse(request!.body)).toEqual({ content, actorId: ACTOR_ID, reason: "restore" });
    expect(request!.headers[SIGNATURE_HEADER]).toBe(
      computeSignature(SECRET, {
        method: "POST",
        path: request!.url,
        body: request!.body,
        timestamp: Number(request!.headers[TIMESTAMP_HEADER]),
        nonce: String(request!.headers[NONCE_HEADER]),
      }),
    );
    expect(Math.abs(Number(request!.headers[TIMESTAMP_HEADER]) - Date.now() / 1000)).toBeLessThan(
      5,
    );
  });

  it("validates input before calling collab", async () => {
    const { url, received } = await fakeCollab(200, {});
    expect(
      await failure(
        replaceDocument({ pageId: "nope", content, actorId: ACTOR_ID }, { url, secret: SECRET }),
      ),
    ).toEqual({ code: "VALIDATION_FAILED", reason: "VALIDATION_FAILED" });
    expect(
      await failure(
        replaceDocument(
          { pageId: PAGE_ID, content: { type: "paragraph" } as never, actorId: ACTOR_ID },
          { url, secret: SECRET },
        ),
      ),
    ).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(received).toHaveLength(0);
  });

  it.each([
    [404, "PAGE_NOT_FOUND", "PAGE_NOT_FOUND"],
    [400, "VALIDATION_FAILED", "VALIDATION_FAILED"],
    [413, "PAYLOAD_TOO_LARGE", "VALIDATION_FAILED"],
    [401, "UNAUTHORIZED", "PAGE_ACTION_FAILED"],
    [503, "INTERNAL_API_DISABLED", "PAGE_ACTION_FAILED"],
    [409, "DOCUMENT_SCHEMA_TOO_NEW", "PAGE_ACTION_FAILED"],
  ])("maps collab %i %s to %s", async (status, collabCode, userCode) => {
    const { url } = await fakeCollab(status, { code: collabCode });
    expect(
      await failure(
        replaceDocument({ pageId: PAGE_ID, content, actorId: ACTOR_ID }, { url, secret: SECRET }),
      ),
    ).toEqual({ code: userCode, reason: collabCode });
  });

  it("reports unreadable responses, timeouts and unreachable servers", async () => {
    const bad = await fakeCollab(502, "<html>Bad gateway</html>");
    expect(
      await failure(
        replaceDocument(
          { pageId: PAGE_ID, content, actorId: ACTOR_ID },
          { url: bad.url, secret: SECRET },
        ),
      ),
    ).toEqual({ code: "PAGE_ACTION_FAILED", reason: "HTTP_502" });

    const odd = await fakeCollab(200, { ok: true });
    expect(
      await failure(
        replaceDocument(
          { pageId: PAGE_ID, content, actorId: ACTOR_ID },
          { url: odd.url, secret: SECRET },
        ),
      ),
    ).toEqual({ code: "PAGE_ACTION_FAILED", reason: "BAD_RESPONSE" });

    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)),
      );
    expect(
      await failure(
        replaceDocument(
          { pageId: PAGE_ID, content, actorId: ACTOR_ID },
          { url: "http://collab.invalid", secret: SECRET, fetch: hanging, timeoutMs: 20 },
        ),
      ),
    ).toEqual({ code: "PAGE_ACTION_FAILED", reason: "TIMEOUT" });

    const offline: typeof fetch = () => Promise.reject(new TypeError("fetch failed"));
    expect(
      await failure(
        replaceDocument(
          { pageId: PAGE_ID, content, actorId: ACTOR_ID },
          { url: "http://collab.invalid", secret: SECRET, fetch: offline },
        ),
      ),
    ).toEqual({ code: "PAGE_ACTION_FAILED", reason: "NETWORK" });
  });

  it("fails with NOT_CONFIGURED when the collab URL or secret is missing", async () => {
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    vi.stubEnv("COLLAB_INTERNAL_URL", "http://127.0.0.1:3001");
    vi.stubEnv("COLLAB_INTERNAL_SECRET", "");
    expect(await failure(replaceDocument({ pageId: PAGE_ID, content, actorId: ACTOR_ID }))).toEqual(
      { code: "PAGE_ACTION_FAILED", reason: "NOT_CONFIGURED" },
    );
  });
});

describe("createPageVersion", () => {
  const VERSION_ID = "3f1d2c4b-5a6e-4f70-8a9b-0c1d2e3f4a5b";

  it("posts a signed request with the trimmed label and returns the version", async () => {
    const { url, received } = await fakeCollab(200, {
      pageId: PAGE_ID,
      versionId: VERSION_ID,
      versionNo: 12,
    });

    await expect(
      createPageVersion(
        { pageId: PAGE_ID, actorId: ACTOR_ID, label: "  Bản đã duyệt " },
        { url, secret: SECRET },
      ),
    ).resolves.toEqual({ pageId: PAGE_ID, versionId: VERSION_ID, versionNo: 12 });

    const [request] = received;
    expect(request!.url).toBe(`/internal/documents/${PAGE_ID}/versions`);
    expect(JSON.parse(request!.body)).toEqual({ actorId: ACTOR_ID, label: "Bản đã duyệt" });
    expect(request!.headers[SIGNATURE_HEADER]).toBe(
      computeSignature(SECRET, {
        method: "POST",
        path: `/internal/documents/${PAGE_ID}/versions`,
        timestamp: Number(request!.headers[TIMESTAMP_HEADER]),
        nonce: String(request!.headers[NONCE_HEADER]),
        body: request!.body,
      }),
    );
  });

  it("leaves an empty label out", async () => {
    const { url, received } = await fakeCollab(200, {
      pageId: PAGE_ID,
      versionId: VERSION_ID,
      versionNo: 1,
    });
    await createPageVersion(
      { pageId: PAGE_ID, actorId: ACTOR_ID, label: "  " },
      { url, secret: SECRET },
    );
    expect(JSON.parse(received[0]!.body)).toEqual({ actorId: ACTOR_ID });
  });

  it("maps collab refusals to user-facing codes", async () => {
    const { url } = await fakeCollab(403, { code: "FORBIDDEN" });
    expect(
      await failure(
        createPageVersion({ pageId: PAGE_ID, actorId: ACTOR_ID }, { url, secret: SECRET }),
      ),
    ).toEqual({ code: "FORBIDDEN", reason: "FORBIDDEN" });
  });

  it("rejects a label longer than 200 characters before calling collab", async () => {
    expect(
      await failure(
        createPageVersion(
          { pageId: PAGE_ID, actorId: ACTOR_ID, label: "x".repeat(201) },
          { url: "http://127.0.0.1:1", secret: SECRET },
        ),
      ),
    ).toEqual({ code: "VALIDATION_FAILED", reason: "VALIDATION_FAILED" });
  });
});
