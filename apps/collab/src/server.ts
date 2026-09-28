import { Database } from "@hocuspocus/extension-database";
import { Server } from "@hocuspocus/server";
import * as Y from "yjs";
import { EDITOR_SCHEMA_VERSION } from "@kb/editor/schema-version";

import { type AccessTokenVerifier, createOriginCheck, parseDocumentName } from "./auth";
import { deriveContent } from "./content";
import type { DocumentStore, SpaceRole } from "./db";
import type { CollabEnv } from "./env";
import { CollabAuthError, DocumentLoadError } from "./errors";
import { healthExtension } from "./health";
import { internalApiExtension } from "./internal-api";
import type { Logger } from "./logger";
import { SnapshotTracker } from "./snapshots";

/** Per-connection context returned by onAuthenticate. */
export interface CollabContext {
  userId: string;
  pageId: string;
  role: SpaceRole;
  /** Set on direct connections opened by the internal API (T3.7). */
  source?: "internal-api";
}

export interface CollabServerDeps {
  env: Pick<
    CollabEnv,
    "PORT" | "APP_VERSION" | "GIT_SHA" | "APP_ENV" | "ALLOWED_ORIGINS" | "COLLAB_INTERNAL_SECRET"
  >;
  store: DocumentStore;
  verifyToken: AccessTokenVerifier;
  logger: Logger;
  /** Store debounce (docs/PLAN.md §7.10: 2 s, at most 10 s). Tests shorten these. */
  debounce?: number;
  maxDebounce?: number;
}

/** Query parameter the web client puts on the WebSocket URL (`?schemaVersion=<n>`). */
export const SCHEMA_VERSION_PARAM = "schemaVersion";

export function createCollabServer({
  env,
  store,
  verifyToken,
  logger,
  debounce = 2_000,
  maxDebounce = 10_000,
}: CollabServerDeps): Server<CollabContext> {
  const isOriginAllowed = createOriginCheck(env.ALLOWED_ORIGINS);
  // documentName → last editor and a change counter, set only by real edits. Unload also calls
  // onStoreDocument; without pending edits nothing is written (no fake last_edited_* / audit).
  const pending = new Map<string, { userId: string | null; seq: number }>();
  // Stored changes not yet in any page version (snapshot policy, snapshots.ts).
  const snapshots = new SnapshotTracker();

  return new Server<CollabContext>({
    name: "kb-collab",
    port: env.PORT,
    quiet: true,
    debounce,
    maxDebounce,
    // SIGTERM/SIGINT: stop accepting, close connections, flush pending stores, run onDestroy.
    stopOnSignals: true,
    extensions: [
      healthExtension(env, store),
      internalApiExtension({ secret: env.COLLAB_INTERNAL_SECRET, logger, store, snapshots }),
      {
        async onAuthenticate({
          token,
          documentName,
          requestHeaders,
          requestParameters,
          connectionConfig,
          socketId,
        }) {
          const log = logger.child({ documentName, socketId });
          try {
            if (!isOriginAllowed(requestHeaders.get("origin")))
              throw new CollabAuthError("ORIGIN_NOT_ALLOWED");
            if (Number(requestParameters.get(SCHEMA_VERSION_PARAM)) !== EDITOR_SCHEMA_VERSION) {
              throw new CollabAuthError("CLIENT_OUTDATED");
            }
            const pageId = parseDocumentName(documentName);
            if (!pageId) throw new CollabAuthError("FORBIDDEN");

            const { userId } = await verifyToken(token);
            const role = await store.authorize(pageId, userId);
            if (!role) throw new CollabAuthError("FORBIDDEN");

            // Viewers receive updates; Hocuspocus drops every update they send.
            connectionConfig.readOnly = role === "viewer";
            log.debug({ userId, role }, "connection authorized");
            return { userId, pageId, role } satisfies CollabContext;
          } catch (error) {
            if (error instanceof CollabAuthError) {
              log.info({ reason: error.reason }, "connection rejected");
              throw error;
            }
            log.error({ err: error }, "authorization failed");
            throw new CollabAuthError("FORBIDDEN");
          }
        },

        async onTokenSync({ token, context }) {
          // Refreshed access token (T3.5): must still be valid and belong to the same user.
          const { userId } = await verifyToken(token);
          if (userId !== context.userId) throw new CollabAuthError("UNAUTHORIZED");
        },

        async onChange({ documentName, context }) {
          const previous = pending.get(documentName);
          pending.set(documentName, {
            userId: context?.userId ?? previous?.userId ?? null,
            seq: (previous?.seq ?? 0) + 1,
          });
        },
      },
      new Database({
        async fetch({ documentName }) {
          const pageId = parseDocumentName(documentName);
          if (!pageId) throw new Error(`invalid document name ${documentName}`);
          const stored = await store.fetch(pageId);
          if (!stored) {
            throw new DocumentLoadError("PAGE_NOT_FOUND", `no page_documents row for ${pageId}`);
          }
          if (stored.schemaVersion > EDITOR_SCHEMA_VERSION) {
            // Written by a newer server: loading and re-saving here could drop unknown nodes.
            logger.error(
              { documentName, stored: stored.schemaVersion, server: EDITOR_SCHEMA_VERSION },
              "document newer than server",
            );
            throw new DocumentLoadError("DOCUMENT_SCHEMA_TOO_NEW", "DOCUMENT_SCHEMA_TOO_NEW");
          }
          // Older schema versions will be migrated here (packages/editor/src/migrations) once a
          // schema change needs one. v1 → v2 (T4.1 table nodes) only adds nodes: v1 documents
          // load unchanged and are stored as v2 on the next save.
          return stored.ydoc;
        },

        async store({ documentName, state, document }) {
          const change = pending.get(documentName);
          if (!change) return;
          const pageId = parseDocumentName(documentName)!;
          const started = performance.now();

          const content = deriveContent(document);
          const outcome = await store.store({
            pageId,
            state,
            schemaVersion: EDITOR_SCHEMA_VERSION,
            content,
            editorId: change.userId,
            snapshot: "due",
          });
          if (pending.get(documentName)?.seq === change.seq) pending.delete(documentName);
          if (outcome !== "missing") snapshots.stored(documentName, outcome, change.userId);

          const bytes = state.byteLength;
          const log = logger.child({
            documentName,
            bytes,
            ms: Math.round(performance.now() - started),
          });
          if (outcome === "missing") log.warn("page is gone, document not stored");
          else if (bytes > 5 * 1024 * 1024) log.warn("document larger than 5 MB");
          else log.debug("document stored");
        },
      }),
      {
        // Last client left (or shutdown): runs after the final store. Changes stored since the
        // last version become an `auto` version (§3.6 b). Never blocks the unload.
        async beforeUnloadDocument({ documentName, document }) {
          const change = snapshots.take(documentName);
          if (!change) return;
          const pageId = parseDocumentName(documentName)!;
          try {
            const version = await store.createVersion({
              pageId,
              state: Y.encodeStateAsUpdate(document),
              schemaVersion: EDITOR_SCHEMA_VERSION,
              content: deriveContent(document),
              actorId: change.editorId,
              reason: "auto",
            });
            logger.debug({ documentName, version }, "version written on unload");
          } catch (error) {
            logger.error({ documentName, err: error }, "could not write version on unload");
          }
        },

        async onDestroy() {
          await store.close();
          logger.info("stopped");
        },
      },
    ],
  });
}
