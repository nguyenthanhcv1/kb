/**
 * kb-collab against a real database (T3.4 acceptance): wrong token rejected, viewer updates
 * ignored, content survives a restart, shutdown flushes pending edits.
 *
 * Needs a migrated Supabase database (`supabase db start`, seed applied):
 *   COLLAB_TEST_DATABASE_URL=postgresql://kb_collab:kb_collab_local@127.0.0.1:54322/postgres
 *   COLLAB_TEST_ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
 * Skipped when they are not set (plain `pnpm test`); CI runs it in the `db` job.
 */
import { randomUUID } from "node:crypto";

import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import type { Server } from "@hocuspocus/server";
import { EDITOR_SCHEMA_VERSION } from "@kb/editor/schema-version";
import { SignJWT } from "jose";
import pg from "pg";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import * as Y from "yjs";

import { createAccessTokenVerifier } from "../src/auth";
import { DOCUMENT_FIELD } from "../src/content";
import { createDocumentStore } from "../src/db";
import { type CollabContext, createCollabServer } from "../src/server";

const DATABASE_URL = process.env.COLLAB_TEST_DATABASE_URL;
const ADMIN_URL = process.env.COLLAB_TEST_ADMIN_DATABASE_URL;
const JWT_SECRET = "collab-integration-test-secret-0123456789";

const ids = {
  admin: randomUUID(),
  editor: randomUUID(),
  viewer: randomUUID(),
  outsider: randomUUID(),
  space: randomUUID(),
  page: randomUUID(),
};
const DOC = `page:${ids.page}`;

let admin: pg.Client;
const servers: Server<CollabContext>[] = [];
const providers: HocuspocusProvider[] = [];

function token(userId: string, secret = JWT_SECRET) {
  return new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(secret));
}

async function startServer(options: { debounce?: number; maxDebounce?: number } = {}) {
  const server = createCollabServer({
    env: {
      PORT: 0,
      APP_VERSION: "test",
      GIT_SHA: "test",
      APP_ENV: "test",
      ALLOWED_ORIGINS: undefined,
    },
    store: createDocumentStore(DATABASE_URL!, { max: 2 }),
    verifyToken: createAccessTokenVerifier({ SUPABASE_JWT_SECRET: JWT_SECRET }),
    logger: pino({ level: "silent" }),
    debounce: options.debounce ?? 50,
    maxDebounce: options.maxDebounce ?? 200,
  });
  await server.listen();
  servers.push(server);
  return server;
}

async function stopServer(server: Server<CollabContext>) {
  await server.destroy();
  servers.splice(servers.indexOf(server), 1);
}

type Connection = { provider: HocuspocusProvider; doc: Y.Doc; readOnly: boolean };

/** Resolves once synced, rejects with the server's refusal reason. */
function connect(
  server: Server<CollabContext>,
  authToken: string,
  { schemaVersion = EDITOR_SCHEMA_VERSION, name = DOC } = {},
): Promise<Connection> {
  const doc = new Y.Doc();
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: `ws://127.0.0.1:${server.address.port}?schemaVersion=${schemaVersion}`,
    WebSocketPolyfill: WebSocket,
    maxAttempts: 1,
  });
  return new Promise((resolve, reject) => {
    let readOnly = false;
    const provider = new HocuspocusProvider({
      name,
      document: doc,
      token: authToken,
      websocketProvider,
      onAuthenticated: ({ scope }) => {
        readOnly = scope === "readonly";
      },
      onAuthenticationFailed: ({ reason }) => {
        provider.destroy();
        websocketProvider.destroy();
        reject(new Error(reason));
      },
      onSynced: () => resolve({ provider, doc, readOnly }),
    });
    providers.push(provider);
    provider.attach();
  });
}

function disconnect({ provider }: Connection) {
  provider.destroy();
  provider.configuration.websocketProvider.destroy();
}

function writeParagraph(doc: Y.Doc, text: string) {
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText(text)]);
  const fragment = doc.getXmlFragment(DOCUMENT_FIELD);
  fragment.insert(fragment.length, [paragraph]);
}

const textOf = (doc: Y.Doc) => doc.getXmlFragment(DOCUMENT_FIELD).toString();

async function row() {
  const { rows } = await admin.query<{
    content_text: string;
    word_count: number;
    content_json: { content?: unknown[] };
    last_edited_by: string | null;
  }>(
    `select d.content_text, d.word_count, d.content_json, p.last_edited_by
     from public.page_documents d join public.pages p on p.id = d.page_id where d.page_id = $1`,
    [ids.page],
  );
  return rows[0]!;
}

async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeout = 5_000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe.skipIf(!DATABASE_URL || !ADMIN_URL)("kb-collab with Postgres", () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query("begin");
    await admin.query(
      "insert into auth.users (id, email) select id, 'collab-' || id || '@example.com' from unnest($1::uuid[]) as id",
      [[ids.admin, ids.editor, ids.viewer, ids.outsider]],
    );
    // Profiles are created as guests (empty allowlist); make them internal users.
    await admin.query("select set_config('request.jwt.claim.role', 'service_role', true)");
    await admin.query("update public.profiles set is_guest = false where id = any($1::uuid[])", [
      [ids.admin, ids.editor, ids.viewer, ids.outsider],
    ]);
    await admin.query("select set_config('request.jwt.claim.role', '', true)");
    await admin.query(
      "insert into public.spaces (id, slug, name, created_by) values ($1, $2, 'Collab test', $3)",
      [ids.space, `collab-${ids.space.slice(0, 8)}`, ids.admin],
    );
    await admin.query(
      `insert into public.space_members (space_id, user_id, role, added_by)
       values ($1, $2, 'editor', $4), ($1, $3, 'viewer', $4)`,
      [ids.space, ids.editor, ids.viewer, ids.admin],
    );
    await admin.query(
      "insert into public.pages (id, space_id, position, title, created_by) values ($1, $2, 'V', 'Collab', $3)",
      [ids.page, ids.space, ids.admin],
    );
    await admin.query("commit");
  });

  afterAll(async () => {
    for (const provider of providers) provider.destroy();
    for (const server of [...servers]) await stopServer(server);
    if (!admin) return;
    await admin.query("update public.pages set deleted_at = now() where id = $1", [ids.page]);
    await admin.query("delete from public.pages where id = $1", [ids.page]);
    await admin.end();
  });

  it("rejects a token signed with another secret", async () => {
    const server = await startServer();
    await expect(
      connect(server, await token(ids.editor, "another-secret-0123456789-0123456789")),
    ).rejects.toThrow("UNAUTHORIZED");
    await stopServer(server);
  });

  it("rejects users without access and unknown pages", async () => {
    const server = await startServer();
    await expect(connect(server, await token(ids.outsider))).rejects.toThrow("FORBIDDEN");
    await expect(
      connect(server, await token(ids.editor), { name: `page:${randomUUID()}` }),
    ).rejects.toThrow("FORBIDDEN");
    await expect(connect(server, await token(ids.editor), { name: "space:x" })).rejects.toThrow(
      "FORBIDDEN",
    );
    await stopServer(server);
  });

  it("rejects a client built for another editor schema", async () => {
    const server = await startServer();
    await expect(
      connect(server, await token(ids.editor), { schemaVersion: EDITOR_SCHEMA_VERSION + 1 }),
    ).rejects.toThrow("CLIENT_OUTDATED");
    await stopServer(server);
  });

  it("stores an editor's changes with derived content, last editor and audit", async () => {
    const server = await startServer();
    const editor = await connect(server, await token(ids.editor));
    expect(editor.readOnly).toBe(false);

    writeParagraph(editor.doc, "Xin chào thế giới");

    const stored = await until(row, (r) => r.content_text === "Xin chào thế giới");
    expect(stored).toMatchObject({
      content_text: "Xin chào thế giới",
      word_count: 4,
      last_edited_by: ids.editor,
    });
    expect(stored.content_json.content).toEqual([
      expect.objectContaining({
        type: "paragraph",
        content: [{ type: "text", text: "Xin chào thế giới" }],
      }),
    ]);

    const { rows } = await admin.query(
      "select count(*)::int as n from public.audit_logs where action = 'page.update_content' and entity_id = $1 and actor_id = $2",
      [ids.page, ids.editor],
    );
    expect(rows[0].n).toBe(1);

    disconnect(editor);
    await stopServer(server);
  });

  it("ignores updates sent by a viewer", async () => {
    const server = await startServer();
    const viewer = await connect(server, await token(ids.viewer));
    expect(viewer.readOnly).toBe(true);
    expect(textOf(viewer.doc)).toContain("Xin chào thế giới");

    writeParagraph(viewer.doc, "Viewer was here");
    await new Promise((resolve) => setTimeout(resolve, 400));

    const serverDoc = server.hocuspocus.documents.get(DOC)!;
    expect(textOf(serverDoc)).not.toContain("Viewer was here");
    expect((await row()).content_text).toBe("Xin chào thế giới");

    disconnect(viewer);
    await stopServer(server);
  });

  it("keeps content across a server restart", async () => {
    const first = await startServer();
    const editor = await connect(first, await token(ids.editor));
    writeParagraph(editor.doc, "Đoạn thứ hai");
    await until(row, (r) => r.content_text.includes("Đoạn thứ hai"));
    disconnect(editor);
    await stopServer(first);

    const second = await startServer();
    const reader = await connect(second, await token(ids.viewer));
    expect(textOf(reader.doc)).toContain("Xin chào thế giới");
    expect(textOf(reader.doc)).toContain("Đoạn thứ hai");
    disconnect(reader);
    await stopServer(second);
  });

  it("flushes pending edits on shutdown (SIGTERM path)", async () => {
    // Long debounce: the edit is only persisted because shutdown flushes it.
    const server = await startServer({ debounce: 60_000, maxDebounce: 120_000 });
    const editor = await connect(server, await token(ids.editor));
    writeParagraph(editor.doc, "Trước khi tắt");
    await until(
      async () => textOf(server.hocuspocus.documents.get(DOC)!),
      (text) => text.includes("Trước khi tắt"),
    );
    expect((await row()).content_text).not.toContain("Trước khi tắt");

    await stopServer(server);
    expect((await row()).content_text).toContain("Trước khi tắt");
    disconnect(editor);
  });
});
