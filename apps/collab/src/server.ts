import { Database } from "@hocuspocus/extension-database";
import { Server } from "@hocuspocus/server";
import { EDITOR_SCHEMA_VERSION } from "@kb/editor/schema-version";

import { type AccessTokenVerifier, createOriginCheck, parseDocumentName } from "./auth";
import { deriveContent } from "./content";
import type { DocumentStore, SpaceRole } from "./db";
import type { CollabEnv } from "./env";
import { CollabAuthError } from "./errors";
import { healthExtension } from "./health";
import type { Logger } from "./logger";

/** Per-connection context returned by onAuthenticate. */
export interface CollabContext {
  userId: string;
  pageId: string;
  role: SpaceRole;
}

export interface CollabServerDeps {
  env: Pick<CollabEnv, "PORT" | "APP_VERSION" | "GIT_SHA" | "APP_ENV" | "ALLOWED_ORIGINS">;
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
          if (!stored) throw new Error(`no page_documents row for ${pageId}`);
          if (stored.schemaVersion > EDITOR_SCHEMA_VERSION) {
            // Written by a newer server: loading and re-saving here could drop unknown nodes.
            logger.error(
              { documentName, stored: stored.schemaVersion, server: EDITOR_SCHEMA_VERSION },
              "document newer than server",
            );
            throw new Error("DOCUMENT_SCHEMA_TOO_NEW");
          }
          // Older schema versions will be migrated here (packages/editor/src/migrations) once a
          // schema change needs one; version 1 is the first.
          return stored.ydoc;
        },

        async store({ documentName, state, document }) {
          const change = pending.get(documentName);
          if (!change) return;
          const pageId = parseDocumentName(documentName)!;
          const started = performance.now();

          const content = deriveContent(document);
          const stored = await store.store({
            pageId,
            state,
            schemaVersion: EDITOR_SCHEMA_VERSION,
            content,
            editorId: change.userId,
          });
          if (pending.get(documentName)?.seq === change.seq) pending.delete(documentName);

          const bytes = state.byteLength;
          const log = logger.child({
            documentName,
            bytes,
            ms: Math.round(performance.now() - started),
          });
          if (!stored) log.warn("page is gone, document not stored");
          else if (bytes > 5 * 1024 * 1024) log.warn("document larger than 5 MB");
          else log.debug("document stored");
        },
      }),
      {
        async onDestroy() {
          await store.close();
          logger.info("stopped");
        },
      },
    ],
  });
}
