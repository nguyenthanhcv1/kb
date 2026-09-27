import type { Extension, onRequestPayload } from "@hocuspocus/server";
import { EDITOR_SCHEMA_VERSION } from "@kb/editor/schema-version";

import type { DocumentStore } from "./db";
import type { CollabEnv } from "./env";

const PING_TIMEOUT_MS = 2_000;

/**
 * `GET /health` for Docker HEALTHCHECK and Coolify (docs/PLAN.md §7.9): process + Postgres
 * `select 1`. 503 when the database is unreachable.
 */
export function healthExtension(
  env: Pick<CollabEnv, "APP_VERSION" | "GIT_SHA" | "APP_ENV">,
  store: Pick<DocumentStore, "ping"> | null,
): Extension {
  return {
    async onRequest({ request, response, instance }: onRequestPayload) {
      const { pathname } = new URL(request.url ?? "/", "http://localhost");
      if (pathname !== "/health") return;

      let database: "ok" | "down" | "disabled" = "disabled";
      if (store) {
        database = await Promise.race([
          store.ping().then(() => "ok" as const),
          new Promise<"down">((resolve) =>
            setTimeout(() => resolve("down"), PING_TIMEOUT_MS).unref(),
          ),
        ]).catch(() => "down" as const);
      }
      const ok = database !== "down";

      response.writeHead(ok ? 200 : 503, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(
        JSON.stringify({
          status: ok ? "ok" : "degraded",
          version: env.APP_VERSION,
          sha: env.GIT_SHA,
          env: env.APP_ENV,
          schemaVersion: EDITOR_SCHEMA_VERSION,
          database,
          connections: instance.getConnectionsCount(),
          documents: instance.getDocumentsCount(),
        }),
      );
      // Hocuspocus convention: rejecting with null stops the default response.
      throw null;
    },
  };
}
