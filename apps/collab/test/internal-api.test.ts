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
import type {
  CreateVersionInput,
  DocumentStore,
  SpaceRole,
  StoredVersion,
  StoreInput,
} from "../src/db";
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

/** In-memory DocumentStore: pages in `docs`, every store call in `stored`, versions in `versions`. */
function memoryStore(
  docs: Map<string, Uint8Array>,
  roles = new Map<string, SpaceRole>(),
  sources = new Map<string, StoredVersion>(),
) {
  const stored: StoreInput[] = [];
  const versions: CreateVersionInput[] = [];
  const store: DocumentStore = {
    async authorize(pageId, userId) {
      return docs.has(pageId) ? (roles.get(userId) ?? ("editor" satisfies SpaceRole)) : null;
    },
    async fetch(pageId) {
      const ydoc = docs.get(pageId);
      return ydoc ? { ydoc, schemaVersion: EDITOR_SCHEMA_VERSION } : null;
    },
    async store(input) {
      stored.push(input);
      docs.set(input.pageId, input.state);
      return "stored";
    },
    async createVersion(input) {
      versions.push(input);
      return { id: randomUUID(), versionNo: versions.length };
    },
    async getVersion(_pageId, versionId) {
      return sources.get(versionId) ?? null;
    },
    async prunePageVersions() {
      return 0;
    },
    async ping() {},
    async close() {},
  };
  return { store, stored, versions };
}

const verifyToken: AccessTokenVerifier = async (token) => ({ userId: token });

const servers: Server<CollabContext>[] = [];
const cleanups: (() => void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const server of servers.splice(0)) await server.destroy();
});

async function startServer(
  docs: Map<string, Uint8Array>,
  {
    disabled = false,
    roles = new Map<string, SpaceRole>(),
    sources = new Map<string, StoredVersion>(),
  } = {},
) {
  const { store, stored, versions } = memoryStore(docs, roles, sources);
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
  return { server, stored, versions, base: `http://127.0.0.1:${server.address.port}` };
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

describe("POST /internal/documents/:id/versions", () => {
  const versionsPath = (pageId: string) => `/internal/documents/${pageId}/versions`;

  it("saves a named manual version of the live document, edits included", async () => {
    const pageId = randomUUID();
    const docs = new Map([[pageId, initialState("Bản nháp")]]);
    const { server, base, versions } = await startServer(docs);
    const client = await connect(server, pageId);
    replaceContent(client.ydoc, parseContentJson(doc("Bản đã duyệt")));
    expect(
      await until(() =>
        server.hocuspocus.documents.get(`page:${pageId}`)
          ? deriveContent(server.hocuspocus.documents.get(`page:${pageId}`)!).contentText ===
            "Bản đã duyệt"
          : false,
      ),
    ).toBe(true);

    const result = await replace(
      base,
      pageId,
      { actorId: ACTOR, label: "  Duyệt lần 1  " },
      { path: versionsPath(pageId) },
    );

    expect(result).toEqual({
      status: 200,
      body: { pageId, versionId: expect.any(String), versionNo: 1 },
    });
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      pageId,
      actorId: ACTOR,
      reason: "manual",
      label: "Duyệt lần 1",
      schemaVersion: EDITOR_SCHEMA_VERSION,
    });
    expect(versions[0]!.content.contentText).toBe("Bản đã duyệt");
    const restored = new Y.Doc();
    Y.applyUpdate(restored, versions[0]!.state);
    expect(text(restored)).toBe("Bản đã duyệt");
  });

  it("refuses viewers, unknown pages and invalid labels", async () => {
    const pageId = randomUUID();
    const viewer = randomUUID();
    const docs = new Map([[pageId, initialState("Nội dung")]]);
    const { base, versions } = await startServer(docs, {
      roles: new Map([[viewer, "viewer" as SpaceRole]]),
    });

    expect(
      await replace(base, pageId, { actorId: viewer }, { path: versionsPath(pageId) }),
    ).toEqual({ status: 403, body: { code: "FORBIDDEN" } });
    const unknown = randomUUID();
    expect(
      await replace(base, unknown, { actorId: ACTOR }, { path: versionsPath(unknown) }),
    ).toEqual({ status: 404, body: { code: "PAGE_NOT_FOUND" } });
    expect(
      await replace(
        base,
        pageId,
        { actorId: ACTOR, label: "x".repeat(201) },
        { path: versionsPath(pageId) },
      ),
    ).toEqual({ status: 400, body: { code: "VALIDATION_FAILED" } });
    expect(versions).toHaveLength(0);
  });

  it("an empty label saves an unnamed version", async () => {
    const pageId = randomUUID();
    const { base, versions } = await startServer(new Map([[pageId, initialState("A")]]));
    const result = await replace(
      base,
      pageId,
      { actorId: ACTOR, label: "" },
      { path: versionsPath(pageId) },
    );
    expect(result.status).toBe(200);
    expect(versions[0]!.label).toBeUndefined();
  });
});

describe("POST /internal/documents/:id/versions/:versionId/restore", () => {
  const restorePath = (pageId: string, versionId: string) =>
    `/internal/documents/${pageId}/versions/${versionId}/restore`;
  const source = (id: string, schemaVersion = EDITOR_SCHEMA_VERSION): StoredVersion => ({
    id,
    versionNo: 3,
    contentJson: doc("Bản cũ"),
    schemaVersion,
  });

  it("saves pre_restore, replaces the live content for open editors, then saves restore", async () => {
    const pageId = randomUUID();
    const versionId = randomUUID();
    const { server, base, versions } = await startServer(
      new Map([[pageId, initialState("Bản hiện tại")]]),
      { sources: new Map([[versionId, source(versionId)]]) },
    );
    const client = await connect(server, pageId);
    expect(text(client.ydoc)).toBe("Bản hiện tại");

    const result = await replace(
      base,
      pageId,
      { actorId: ACTOR },
      { path: restorePath(pageId, versionId) },
    );

    expect(result).toEqual({
      status: 200,
      body: {
        pageId,
        restoredFromVersionId: versionId,
        restoredFromVersionNo: 3,
        preRestoreVersionId: expect.any(String),
        preRestoreVersionNo: 1,
        versionId: expect.any(String),
        versionNo: 2,
        schemaVersion: EDITOR_SCHEMA_VERSION,
        connections: 1,
      },
    });
    expect(versions.map((v) => v.reason)).toEqual(["pre_restore", "restore"]);
    expect(versions[0]!.content.contentText).toBe("Bản hiện tại");
    expect(versions[1]!.content.contentText).toBe("Bản cũ");
    expect(versions[1]).toMatchObject({ restoredFromVersionId: versionId, actorId: ACTOR });
    expect(await until(() => text(client.ydoc) === "Bản cũ")).toBe(true);
    expect(await until(() => client.stateless.length > 0)).toBe(true);
    expect(JSON.parse(client.stateless[0]!)).toEqual({
      type: "document.replaced",
      reason: "restore",
      actorId: ACTOR,
    });
  });

  it("refuses viewers, unknown versions and versions of a newer schema without changing anything", async () => {
    const pageId = randomUUID();
    const viewer = randomUUID();
    const versionId = randomUUID();
    const newer = randomUUID();
    const { base, versions, stored } = await startServer(
      new Map([[pageId, initialState("Giữ nguyên")]]),
      {
        roles: new Map([[viewer, "viewer" as SpaceRole]]),
        sources: new Map([
          [versionId, source(versionId)],
          [newer, source(newer, EDITOR_SCHEMA_VERSION + 1)],
        ]),
      },
    );
    const call = (actorId: string, id: string, page = pageId) =>
      replace(base, page, { actorId }, { path: restorePath(page, id) });

    expect(await call(viewer, versionId)).toEqual({ status: 403, body: { code: "FORBIDDEN" } });
    expect(await call(ACTOR, randomUUID())).toEqual({
      status: 404,
      body: { code: "VERSION_NOT_FOUND" },
    });
    expect(await call(ACTOR, newer)).toEqual({
      status: 409,
      body: { code: "DOCUMENT_SCHEMA_TOO_NEW" },
    });
    const unknownPage = randomUUID();
    expect(await call(ACTOR, versionId, unknownPage)).toEqual({
      status: 404,
      body: { code: "PAGE_NOT_FOUND" },
    });
    expect(await call("not-a-uuid", versionId)).toEqual({
      status: 400,
      body: { code: "VALIDATION_FAILED" },
    });
    expect(versions).toHaveLength(0);
    expect(stored).toHaveLength(0);
  });
});

describe("snapshot policy", () => {
  it("asks for an auto version on every store and writes one when the document unloads", async () => {
    const pageId = randomUUID();
    const docs = new Map([[pageId, initialState("Trước")]]);
    const { server, base, stored, versions } = await startServer(docs);

    await replace(base, pageId, { content: doc("Sau"), actorId: ACTOR });
    expect(stored[0]!.snapshot).toBe("due");
    expect(await until(() => server.hocuspocus.getDocumentsCount() === 0)).toBe(true);

    // The in-memory store never reports "snapshotted": the unload writes the auto version.
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ pageId, reason: "auto", actorId: ACTOR });
    expect(versions[0]!.content.contentText).toBe("Sau");
  });

  it("writes nothing on unload when no change was stored", async () => {
    const pageId = randomUUID();
    const { server, versions } = await startServer(new Map([[pageId, initialState("A")]]));
    await connect(server, pageId);
    for (const cleanup of cleanups.splice(0)) cleanup();
    expect(await until(() => server.hocuspocus.getDocumentsCount() === 0)).toBe(true);
    expect(versions).toHaveLength(0);
  });

  it("a manual version covers the stored changes: nothing more on unload", async () => {
    const pageId = randomUUID();
    const docs = new Map([[pageId, initialState("A")]]);
    const { server, base, versions } = await startServer(docs);
    const client = await connect(server, pageId);
    replaceContent(client.ydoc, parseContentJson(doc("B")));
    await new Promise((r) => setTimeout(r, 300)); // debounced store (50–200 ms)

    await replace(
      base,
      pageId,
      { actorId: ACTOR },
      { path: `/internal/documents/${pageId}/versions` },
    );
    for (const cleanup of cleanups.splice(0)) cleanup();
    expect(await until(() => server.hocuspocus.getDocumentsCount() === 0)).toBe(true);
    expect(versions.map((v) => v.reason)).toEqual(["manual"]);
  });
});
