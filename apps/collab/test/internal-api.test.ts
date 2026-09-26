/**
 * Internal API (T3.7 acceptance) against a real kb-collab server and real WebSocket clients, with
 * an in-memory document store (the Postgres path is covered in collab.integration.test.ts).
 */
import { randomUUID } from "node:crypto";

import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import type { Server } from "@hocuspocus/server";
import { EDITOR_SCHEMA_VERSION } from "@kb/editor/schema-version";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import * as Y from "yjs";

import type { AccessTokenVerifier } from "../src/auth";
import { deriveContent, parseContentJson, replaceContent } from "../src/content";
import type { DocumentStore, SpaceRole, StoreInput } from "../src/db";
import { signRequest } from "../src/internal-signature";
import { type CollabContext, createCollabServer } from "../src/server";

const SECRET = "internal-api-test-secret-0123456789-abcdef";
const EDITOR = randomUUID();
const ACTOR = randomUUID();

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...texts: string[]) => ({ type: "doc", content: texts.map(paragraph) });

function initialState(...texts: string[]) {
  const ydoc = new Y.Doc();
  replaceContent(ydoc, parseContentJson(doc(...texts)));
  return Y.encodeStateAsUpdate(ydoc);
}

/** In-memory DocumentStore: pages in `docs`, every store call in `stored`. */
function memoryStore(docs: Map<string, Uint8Array>) {
  const stored: StoreInput[] = [];
  const store: DocumentStore = {
    async authorize(pageId) {
      return docs.has(pageId) ? ("editor" satisfies SpaceRole) : null;
    },
    async fetch(pageId) {
      const ydoc = docs.get(pageId);
      return ydoc ? { ydoc, schemaVersion: EDITOR_SCHEMA_VERSION } : null;
    },
    async store(input) {
      stored.push(input);
      docs.set(input.pageId, input.state);
      return true;
    },
    async ping() {},
    async close() {},
  };
  return { store, stored };
}

const verifyToken: AccessTokenVerifier = async (token) => ({ userId: token });

const servers: Server<CollabContext>[] = [];
const cleanups: (() => void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const server of servers.splice(0)) await server.destroy();
});

async function startServer(docs: Map<string, Uint8Array>, { disabled = false } = {}) {
  const { store, stored } = memoryStore(docs);
  const server = createCollabServer({
    env: {
      PORT: 0,
      APP_VERSION: "test",
      GIT_SHA: "test",
      APP_ENV: "test",
      ALLOWED_ORIGINS: undefined,
      COLLAB_INTERNAL_SECRET: disabled ? undefined : SECRET,
    },
    store,
    verifyToken,
    logger: pino({ level: "silent" }),
    debounce: 50,
    maxDebounce: 200,
  });
  await server.listen();
  servers.push(server);
  return { server, stored, base: `http://127.0.0.1:${server.address.port}` };
}

function connect(server: Server<CollabContext>, pageId: string) {
  const ydoc = new Y.Doc();
  const stateless: string[] = [];
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: `ws://127.0.0.1:${server.address.port}?schemaVersion=${EDITOR_SCHEMA_VERSION}`,
    WebSocketPolyfill: WebSocket,
    maxAttempts: 1,
  });
  return new Promise<{ ydoc: Y.Doc; stateless: string[] }>((resolve, reject) => {
    const provider = new HocuspocusProvider({
      name: `page:${pageId}`,
      document: ydoc,
      token: EDITOR,
      websocketProvider,
      onAuthenticationFailed: ({ reason }) => reject(new Error(reason)),
      onStateless: ({ payload }) => stateless.push(payload),
      onSynced: () => resolve({ ydoc, stateless }),
    });
    cleanups.push(() => {
      provider.destroy();
      websocketProvider.destroy();
    });
    provider.attach();
  });
}

const text = (ydoc: Y.Doc) => deriveContent(ydoc).contentText;

async function until(check: () => boolean, timeout = 3_000) {
  const deadline = Date.now() + timeout;
  while (!check() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  return check();
}

async function replace(
  base: string,
  pageId: string,
  body: unknown,
  { secret = SECRET, headers = {} as Record<string, string>, method = "POST", path = "" } = {},
) {
  const url = path || `/internal/documents/${pageId}/replace`;
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const response = await fetch(base + url, {
    method,
    body: method === "GET" ? undefined : raw,
    headers: {
      "content-type": "application/json",
      ...signRequest(secret, { method, path: url, body: method === "GET" ? "" : raw }),
      ...headers,
    },
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("POST /internal/documents/:id/replace", () => {
  it("replaces the content for every connected client and stores it as the actor", async () => {
    const pageId = randomUUID();
    const docs = new Map([[pageId, initialState("Bản cũ", "Đoạn giữ lại")]]);
    const { server, base, stored } = await startServer(docs);
    const first = await connect(server, pageId);
    const second = await connect(server, pageId);
    expect(text(first.ydoc)).toContain("Bản cũ");

    const result = await replace(base, pageId, {
      content: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Khôi phục" }] },
          paragraph("Đoạn giữ lại"),
        ],
      },
      actorId: ACTOR,
      reason: "restore",
    });

    expect(result).toEqual({
      status: 200,
      body: { pageId, schemaVersion: EDITOR_SCHEMA_VERSION, connections: 2 },
    });
    for (const client of [first, second]) {
      expect(await until(() => deriveContent(client.ydoc).headingsText === "Khôi phục")).toBe(true);
      expect(text(client.ydoc)).toBe("Đoạn giữ lại");
      expect(await until(() => client.stateless.length === 1)).toBe(true);
      expect(JSON.parse(client.stateless[0]!)).toEqual({
        type: "document.replaced",
        reason: "restore",
        actorId: ACTOR,
      });
    }

    // Persisted through the normal store hook before the response, with the actor as editor.
    const last = stored.at(-1)!;
    expect(last).toMatchObject({ pageId, editorId: ACTOR });
    expect(last.content.headingsText).toBe("Khôi phục");
    expect(server.hocuspocus.getDocumentsCount()).toBe(1);
  });

  it("loads, replaces, stores and unloads a document nobody has open", async () => {
    const pageId = randomUUID();
    const docs = new Map([[pageId, initialState("Trước")]]);
    const { server, base, stored } = await startServer(docs);

    const result = await replace(base, pageId, { content: doc("Sau"), actorId: ACTOR });
    expect(result).toMatchObject({ status: 200, body: { connections: 0 } });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.content.contentText).toBe("Sau");
    expect(await until(() => server.hocuspocus.getDocumentsCount() === 0)).toBe(true);

    const reader = await connect(server, pageId);
    expect(text(reader.ydoc)).toBe("Sau");
  });

  it("rejects unsigned, badly signed, replayed and stale requests", async () => {
    const pageId = randomUUID();
    const docs = new Map([[pageId, initialState("Không đổi")]]);
    const { server, base, stored } = await startServer(docs);
    const body = JSON.stringify({ content: doc("Tấn công"), actorId: ACTOR });
    const path = `/internal/documents/${pageId}/replace`;

    const unsigned = await fetch(base + path, { method: "POST", body });
    expect(unsigned.status).toBe(401);
    expect(await unsigned.json()).toEqual({ code: "UNAUTHORIZED" });

    expect(
      await replace(base, pageId, body, { secret: "wrong-secret-0123456789-0123456789-abc" }),
    ).toEqual({ status: 401, body: { code: "UNAUTHORIZED" } });

    const stale = signRequest(SECRET, { method: "POST", path, body }, Date.now() - 5 * 60_000);
    expect((await fetch(base + path, { method: "POST", body, headers: stale })).status).toBe(401);

    // Signed for another page: path is part of the signature.
    const other = signRequest(SECRET, {
      method: "POST",
      path: path.replace(pageId, randomUUID()),
      body,
    });
    expect((await fetch(base + path, { method: "POST", body, headers: other })).status).toBe(401);

    const headers = signRequest(SECRET, { method: "POST", path, body });
    expect((await fetch(base + path, { method: "POST", body, headers })).status).toBe(200);
    const replayed = await fetch(base + path, { method: "POST", body, headers });
    expect(replayed.status).toBe(401);

    expect(stored).toHaveLength(1);
    const reader = await connect(server, pageId);
    expect(text(reader.ydoc)).toBe("Tấn công");
  });

  it("answers 404 to requests that came through the public proxy, even when signed", async () => {
    const pageId = randomUUID();
    const { base, stored } = await startServer(new Map([[pageId, initialState("A")]]));
    for (const header of ["x-forwarded-for", "forwarded", "cf-connecting-ip", "x-real-ip"]) {
      expect(
        await replace(
          base,
          pageId,
          { content: doc("B"), actorId: ACTOR },
          { headers: { [header]: "203.0.113.7" } },
        ),
      ).toEqual({ status: 404, body: { code: "NOT_FOUND" } });
    }
    expect(stored).toHaveLength(0);
  });

  it("returns error codes for invalid input and unknown pages", async () => {
    const pageId = randomUUID();
    const { base } = await startServer(new Map([[pageId, initialState("A")]]));

    expect(await replace(base, pageId, "{not json")).toEqual({
      status: 400,
      body: { code: "VALIDATION_FAILED" },
    });
    expect(await replace(base, pageId, { content: doc("x") })).toMatchObject({
      status: 400,
      body: { code: "VALIDATION_FAILED" },
    });
    expect(
      await replace(base, pageId, {
        content: { type: "doc", content: [{ type: "evilBlock" }] },
        actorId: ACTOR,
      }),
    ).toMatchObject({ status: 400, body: { code: "VALIDATION_FAILED" } });
    expect(await replace(base, "not-a-uuid", { content: doc("x"), actorId: ACTOR })).toMatchObject({
      status: 400,
      body: { code: "VALIDATION_FAILED" },
    });
    expect(await replace(base, randomUUID(), { content: doc("x"), actorId: ACTOR })).toEqual({
      status: 404,
      body: { code: "PAGE_NOT_FOUND" },
    });
    expect(await replace(base, pageId, "", { method: "GET" })).toEqual({
      status: 405,
      body: { code: "METHOD_NOT_ALLOWED" },
    });
    expect(await replace(base, pageId, {}, { path: "/internal/documents" })).toEqual({
      status: 404,
      body: { code: "NOT_FOUND" },
    });
  });

  it("is disabled without COLLAB_INTERNAL_SECRET", async () => {
    const pageId = randomUUID();
    const { base } = await startServer(new Map([[pageId, initialState("A")]]), { disabled: true });
    expect(await replace(base, pageId, { content: doc("B"), actorId: ACTOR })).toEqual({
      status: 503,
      body: { code: "INTERNAL_API_DISABLED" },
    });
  });
});
