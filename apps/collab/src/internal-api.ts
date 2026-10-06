import type { IncomingMessage, ServerResponse } from "node:http";

import type { Extension, Hocuspocus, onRequestPayload } from "@hocuspocus/server";
import { EDITOR_SCHEMA_VERSION } from "@kb/editor/schema-version";
import { z } from "zod";

import * as Y from "yjs";

import { parseDocumentName } from "./auth";
import { deriveContent, parseContentJson, replaceContent } from "./content";
import type { DocumentStore } from "./db";
import { DocumentLoadError, type InternalApiErrorCode } from "./errors";
import { createSignatureVerifier, type SignatureVerifier } from "./internal-signature";
import type { Logger } from "./logger";
import { type SnapshotTracker, VERSION_LABEL_MAX_LENGTH } from "./snapshots";

/**
 * Internal API of kb-collab (docs/PLAN.md §1.2, task T3.7): the only way for kb-web to change a
 * page's content (restore a version, apply a template, import). Content goes through a Hocuspocus
 * direct connection, so every open editor receives it immediately and it is persisted by the
 * regular Database `store` hook (derived content, last editor, audit) — no second write path.
 *
 * ## `POST /internal/documents/:pageId/replace`
 *
 * Signed with HMAC (see `internal-signature.ts`). Body:
 *
 * ```json
 * { "content": { "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Xin chào" }] }] },
 *   "actorId": "00000000-0000-4000-8000-000000000001",
 *   "reason": "restore" }
 * ```
 *
 * - `content`: TipTap JSON of the whole document, validated against the shared editor schema.
 * - `actorId`: user on whose behalf the change is made (pages.last_edited_by, audit actor).
 * - `reason` (optional): broadcast to open editors as a stateless message
 *   `{"type":"document.replaced","reason":"restore","actorId":"…"}` so the UI can show a toast.
 *
 * `200 {"pageId","schemaVersion","connections"}` once the change is applied and the store hook has
 * run (`connections` = WebSocket clients that received it; a failing store is logged and retried
 * with the next change, the document stays in memory). Errors: `{"code": InternalApiErrorCode}`.
 *
 * ## `POST /internal/documents/:pageId/versions`
 *
 * Saves a `manual` page version of the live document (T6.1b, "Save version"). Body:
 *
 * ```json
 * { "actorId": "00000000-0000-4000-8000-000000000001", "label": "Bản đã duyệt" }
 * ```
 *
 * - `actorId`: author of the version; must be an editor or admin of the page (checked again here).
 * - `label` (optional): name shown in the history, 1–200 characters after trimming.
 *
 * `200 {"pageId","versionId","versionNo"}`. The version holds the in-memory state, including
 * edits still waiting for the debounced store. Errors: `FORBIDDEN` (403), `PAGE_NOT_FOUND` (404),
 * `VALIDATION_FAILED` (400), `VERSION_FAILED` (500).
 *
 * ## `POST /internal/documents/:pageId/versions/:versionId/restore`
 *
 * Restores a page version (T6.3a): one request, one flow, all through kb-collab so open editors
 * get the content live and nothing else writes `page_documents`:
 *
 * 1. checks `actorId` is an editor or admin of the page (viewers: `FORBIDDEN`),
 * 2. loads the source version (`VERSION_NOT_FOUND` when missing / of another page; a version
 *    written by a newer editor schema: `DOCUMENT_SCHEMA_TOO_NEW`),
 * 3. saves a `pre_restore` version of the live document (edits not yet stored included) so the
 *    restore can be undone by restoring that version,
 * 4. replaces the content with the source version's, broadcasting the stateless message
 *    `{"type":"document.replaced","reason":"restore","actorId":"…"}` to open editors,
 * 5. saves a `restore` version (`restored_from_version_id` = source). A DB trigger audits it as
 *    `version.restore` (actor = `actorId`).
 *
 * Body `{ "actorId": "…" }`. `200 {"pageId","restoredFromVersionId","restoredFromVersionNo",
 * "preRestoreVersionId","preRestoreVersionNo","versionId","versionNo","schemaVersion","connections"}`.
 * If a step fails nothing later runs: failing before 4 leaves the content untouched (a
 * `pre_restore` version may exist); errors `FORBIDDEN` (403), `PAGE_NOT_FOUND` / `VERSION_NOT_FOUND`
 * (404), `DOCUMENT_SCHEMA_TOO_NEW` (409), `VALIDATION_FAILED` (400), `RESTORE_FAILED` (500).
 *
 * ## Keeping it off the Internet
 *
 * The route shares port 3001 with the public WebSocket endpoint (kb-web calls
 * `http://kb-collab:3001` over the Docker network). Three layers keep it internal:
 * 1. Requests carrying proxy headers (`X-Forwarded-For`, `Forwarded`, `X-Real-IP`,
 *    `CF-Connecting-IP`) came through Traefik/Cloudflare and get a plain 404, whatever they sign.
 *    Direct calls on the internal network carry none of them.
 * 2. HMAC-SHA256 over method, path and body with `COLLAB_INTERNAL_SECRET`, a ±60 s timestamp
 *    window and single-use nonces. Without the secret the API is disabled (503).
 * 3. The public router should not route `/internal/*` at all (Traefik rule on kb-collab's
 *    domain, docs/PLAN.md §7.4) — configured in Coolify, outside this service.
 */

/** Larger than any real page (the store warns above 5 MB of Yjs state). */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** Headers set by Traefik / Cloudflare / other reverse proxies. */
const PROXY_HEADERS = [
  "x-forwarded-for",
  "x-forwarded-host",
  "forwarded",
  "x-real-ip",
  "cf-connecting-ip",
];

const REPLACE_ROUTE = /^\/internal\/documents\/([^/]+)\/replace$/;
const VERSIONS_ROUTE = /^\/internal\/documents\/([^/]+)\/versions$/;
const RESTORE_ROUTE = /^\/internal\/documents\/([^/]+)\/versions\/([^/]+)\/restore$/;

export const REPLACE_REASONS = ["restore", "template", "import", "assistant"] as const;

/** Type of the stateless message sent to open editors after a replace (web toast, T6.3b). */
export const DOCUMENT_REPLACED_MESSAGE = "document.replaced";

interface ProseMirrorJson {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorJson[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

const markJsonSchema = z.object({
  type: z.string().min(1).max(100),
  attrs: z.record(z.string(), z.unknown()).optional(),
});

const nodeJsonSchema: z.ZodType<ProseMirrorJson> = z.object({
  type: z.string().min(1).max(100),
  attrs: z.record(z.string(), z.unknown()).optional(),
  get content() {
    return z.array(nodeJsonSchema).optional();
  },
  marks: z.array(markJsonSchema).optional(),
  text: z.string().optional(),
});

export const replaceBodySchema = z.object({
  content: nodeJsonSchema.refine((node) => node.type === "doc", { error: "root must be doc" }),
  actorId: z.guid(),
  reason: z.enum(REPLACE_REASONS).optional(),
});
export type ReplaceBody = z.infer<typeof replaceBodySchema>;

export const createVersionBodySchema = z.object({
  actorId: z.guid(),
  label: z
    .string()
    .trim()
    .min(1)
    .max(VERSION_LABEL_MAX_LENGTH)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});
export type CreateVersionBody = z.infer<typeof createVersionBodySchema>;

export const restoreBodySchema = z.object({ actorId: z.guid() });

export interface InternalApiOptions {
  /** COLLAB_INTERNAL_SECRET; undefined disables the API. */
  secret: string | undefined;
  logger: Logger;
  /** Page versions (manual "Save version"); without it the versions route answers 404. */
  store?: Pick<DocumentStore, "authorize" | "createVersion" | "getVersion">;
  snapshots?: SnapshotTracker;
  /** Injected in tests. */
  verifier?: SignatureVerifier;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: InternalApiErrorCode,
  ) {
    super(code);
  }
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<Uint8Array> {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, "PAYLOAD_TOO_LARGE");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "PAYLOAD_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function internalApiExtension({
  secret,
  logger,
  verifier,
  store,
  snapshots,
}: InternalApiOptions): Extension {
  const signatures = verifier ?? (secret ? createSignatureVerifier(secret) : null);
  const log = logger.child({ component: "internal-api" });

  async function handle(request: IncomingMessage, path: string, instance: Hocuspocus) {
    if (!signatures) throw new HttpError(503, "INTERNAL_API_DISABLED");

    const body = await readBody(request);
    const method = request.method ?? "GET";
    const check = signatures.verify({ method, path, body, headers: request.headers });
    if (!check.ok) {
      log.warn({ path, failure: check.failure }, "internal request rejected");
      throw new HttpError(401, "UNAUTHORIZED");
    }

    const pathname = new URL(path, "http://localhost").pathname;
    const replaceMatch = REPLACE_ROUTE.exec(pathname);
    const versionsMatch = store ? VERSIONS_ROUTE.exec(pathname) : null;
    const restoreMatch = store ? RESTORE_ROUTE.exec(pathname) : null;
    if (!replaceMatch && !versionsMatch && !restoreMatch) throw new HttpError(404, "NOT_FOUND");
    if (method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED");
    if (restoreMatch) return restore(instance, restoreMatch[1]!, restoreMatch[2]!, body);
    return replaceMatch
      ? replace(instance, replaceMatch[1]!, body)
      : createVersion(instance, versionsMatch![1]!, body);
  }

  async function createVersion(instance: Hocuspocus, rawPageId: string, raw: Uint8Array) {
    const pageId = parseDocumentName(`page:${decodeURIComponent(rawPageId)}`);
    if (!pageId || !store) throw new HttpError(400, "VALIDATION_FAILED");

    let input: CreateVersionBody;
    try {
      input = createVersionBodySchema.parse(JSON.parse(Buffer.from(raw).toString("utf8")));
    } catch (error) {
      log.info({ pageId, err: error }, "invalid version request");
      throw new HttpError(400, "VALIDATION_FAILED");
    }

    // Defence in depth: kb-web checks too, but a manual version is authored by `actorId`.
    const role = await store.authorize(pageId, input.actorId);
    if (role !== "editor" && role !== "admin") {
      throw new HttpError(
        role === null ? 404 : 403,
        role === null ? "PAGE_NOT_FOUND" : "FORBIDDEN",
      );
    }

    const documentName = `page:${pageId}`;
    let connection: Awaited<ReturnType<Hocuspocus["openDirectConnection"]>>;
    try {
      connection = await instance.openDirectConnection(documentName, {
        userId: input.actorId,
        pageId,
        role,
        source: "internal-api",
      });
    } catch (error) {
      if (error instanceof DocumentLoadError)
        throw new HttpError(error.code === "PAGE_NOT_FOUND" ? 404 : 409, error.code);
      log.error({ pageId, err: error }, "could not load document");
      throw new HttpError(500, "VERSION_FAILED");
    }

    try {
      const document = connection.document!;
      const version = await store.createVersion({
        pageId,
        state: Y.encodeStateAsUpdate(document),
        schemaVersion: EDITOR_SCHEMA_VERSION,
        content: deriveContent(document),
        actorId: input.actorId,
        reason: "manual",
        label: input.label,
      });
      if (!version) throw new HttpError(404, "PAGE_NOT_FOUND");
      snapshots?.snapshotted(documentName);
      log.info({ pageId, actorId: input.actorId, versionNo: version.versionNo }, "version saved");
      return { pageId, versionId: version.id, versionNo: version.versionNo };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      log.error({ pageId, err: error }, "version failed");
      throw new HttpError(500, "VERSION_FAILED");
    } finally {
      await connection.disconnect();
    }
  }

  async function restore(
    instance: Hocuspocus,
    rawPageId: string,
    rawVersionId: string,
    raw: Uint8Array,
  ) {
    const pageId = parseDocumentName(`page:${decodeURIComponent(rawPageId)}`);
    const versionId = z.guid().safeParse(decodeURIComponent(rawVersionId));
    if (!pageId || !versionId.success || !store) throw new HttpError(400, "VALIDATION_FAILED");

    let input: z.infer<typeof restoreBodySchema>;
    try {
      input = restoreBodySchema.parse(JSON.parse(Buffer.from(raw).toString("utf8")));
    } catch (error) {
      log.info({ pageId, err: error }, "invalid restore request");
      throw new HttpError(400, "VALIDATION_FAILED");
    }

    const role = await store.authorize(pageId, input.actorId);
    if (role !== "editor" && role !== "admin") {
      throw new HttpError(
        role === null ? 404 : 403,
        role === null ? "PAGE_NOT_FOUND" : "FORBIDDEN",
      );
    }

    const source = await store.getVersion(pageId, versionId.data);
    if (!source) throw new HttpError(404, "VERSION_NOT_FOUND");
    if (source.schemaVersion > EDITOR_SCHEMA_VERSION) {
      throw new HttpError(409, "DOCUMENT_SCHEMA_TOO_NEW");
    }
    let node: ReturnType<typeof parseContentJson>;
    try {
      node = parseContentJson(source.contentJson);
    } catch (error) {
      log.error({ pageId, versionId: source.id, err: error }, "version content is not valid");
      throw new HttpError(500, "RESTORE_FAILED");
    }

    const documentName = `page:${pageId}`;
    let connection: Awaited<ReturnType<Hocuspocus["openDirectConnection"]>>;
    try {
      connection = await instance.openDirectConnection(documentName, {
        userId: input.actorId,
        pageId,
        role,
        source: "internal-api",
      });
    } catch (error) {
      if (error instanceof DocumentLoadError)
        throw new HttpError(error.code === "PAGE_NOT_FOUND" ? 404 : 409, error.code);
      log.error({ pageId, err: error }, "could not load document");
      throw new HttpError(500, "RESTORE_FAILED");
    }

    try {
      const document = connection.document!;
      const snapshot = async (
        reason: "pre_restore" | "restore",
        restoredFromVersionId?: string,
      ) => {
        const version = await store.createVersion({
          pageId,
          state: Y.encodeStateAsUpdate(document),
          schemaVersion: EDITOR_SCHEMA_VERSION,
          content: deriveContent(document),
          actorId: input.actorId,
          reason,
          restoredFromVersionId,
        });
        if (!version) throw new HttpError(404, "PAGE_NOT_FOUND");
        return version;
      };

      // 1. Safety net first: whatever happens next, the live content is in a version.
      const preRestore = await snapshot("pre_restore");
      // 2. Replace for everyone (open editors receive it through Yjs).
      await connection.transact((doc) => {
        replaceContent(doc, node);
      });
      const connections = document.getConnections().length;
      document.broadcastStateless(
        JSON.stringify({
          type: DOCUMENT_REPLACED_MESSAGE,
          reason: "restore",
          actorId: input.actorId,
        }),
      );
      // 3. The restore itself (audited as `version.restore` by the DB).
      const restored = await snapshot("restore", source.id);
      snapshots?.snapshotted(documentName);

      log.info(
        { pageId, actorId: input.actorId, from: source.versionNo, versionNo: restored.versionNo },
        "version restored",
      );
      return {
        pageId,
        restoredFromVersionId: source.id,
        restoredFromVersionNo: source.versionNo,
        preRestoreVersionId: preRestore.id,
        preRestoreVersionNo: preRestore.versionNo,
        versionId: restored.id,
        versionNo: restored.versionNo,
        schemaVersion: EDITOR_SCHEMA_VERSION,
        connections,
      };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      log.error({ pageId, err: error }, "restore failed");
      throw new HttpError(500, "RESTORE_FAILED");
    } finally {
      await connection.disconnect();
    }
  }

  async function replace(instance: Hocuspocus, rawPageId: string, raw: Uint8Array) {
    const pageId = parseDocumentName(`page:${decodeURIComponent(rawPageId)}`);
    if (!pageId) throw new HttpError(400, "VALIDATION_FAILED");

    let input: ReplaceBody;
    let node: ReturnType<typeof parseContentJson>;
    try {
      input = replaceBodySchema.parse(JSON.parse(Buffer.from(raw).toString("utf8")));
      node = parseContentJson(input.content);
    } catch (error) {
      log.info({ pageId, err: error }, "invalid replace request");
      throw new HttpError(400, "VALIDATION_FAILED");
    }

    const documentName = `page:${pageId}`;
    let connection: Awaited<ReturnType<Hocuspocus["openDirectConnection"]>>;
    try {
      // Same context shape as WebSocket connections: onChange records `userId` as last editor.
      connection = await instance.openDirectConnection(documentName, {
        userId: input.actorId,
        pageId,
        role: "editor",
        source: "internal-api",
      });
    } catch (error) {
      if (error instanceof DocumentLoadError)
        throw new HttpError(error.code === "PAGE_NOT_FOUND" ? 404 : 409, error.code);
      log.error({ pageId, err: error }, "could not load document");
      throw new HttpError(500, "REPLACE_FAILED");
    }

    let connections = 0;
    try {
      await connection.transact((document) => {
        replaceContent(document, node);
      });
      const document = connection.document!;
      connections = document.getConnections().length;
      if (input.reason) {
        document.broadcastStateless(
          JSON.stringify({
            type: DOCUMENT_REPLACED_MESSAGE,
            reason: input.reason,
            actorId: input.actorId,
          }),
        );
      }
    } catch (error) {
      log.error({ pageId, err: error }, "replace failed");
      throw new HttpError(500, "REPLACE_FAILED");
    } finally {
      // Stores right away (normal store hook), then unloads the document if nobody has it open.
      await connection.disconnect();
    }

    log.info(
      { pageId, actorId: input.actorId, reason: input.reason, connections },
      "document replaced",
    );
    return { pageId, schemaVersion: EDITOR_SCHEMA_VERSION, connections };
  }

  return {
    async onRequest({ request, response, instance }: onRequestPayload) {
      const path = request.url ?? "/";
      if (!path.startsWith("/internal/") && path !== "/internal") return;

      try {
        if (PROXY_HEADERS.some((name) => request.headers[name] !== undefined)) {
          log.warn({ path }, "internal route requested through a proxy");
          throw new HttpError(404, "NOT_FOUND");
        }
        send(response, 200, await handle(request, path, instance));
      } catch (error) {
        const { status, code } =
          error instanceof HttpError ? error : { status: 500, code: "REPLACE_FAILED" as const };
        if (!(error instanceof HttpError))
          log.error({ path, err: error }, "internal request failed");
        if (!response.headersSent) send(response, status, { code });
        // Unread body (rejected early) must not keep the socket busy.
        request.resume();
      }
      // Hocuspocus convention: rejecting with null stops the default response.
      throw null;
    },
  };
}
