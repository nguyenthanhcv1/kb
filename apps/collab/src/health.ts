import type { Extension, onRequestPayload } from "@hocuspocus/server";

import type { CollabEnv } from "./env";

/**
 * `GET /health` for Docker HEALTHCHECK and Coolify (docs/PLAN.md §7.9). T3.4 adds the Postgres
 * pool check and the editor schema version.
 */
export function healthExtension(
  env: Pick<CollabEnv, "APP_VERSION" | "GIT_SHA" | "APP_ENV">,
): Extension {
  return {
    async onRequest({ request, response, instance }: onRequestPayload) {
      const { pathname } = new URL(request.url ?? "/", "http://localhost");
      if (pathname !== "/health") return;

      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(
        JSON.stringify({
          status: "ok",
          version: env.APP_VERSION,
          sha: env.GIT_SHA,
          env: env.APP_ENV,
          connections: instance.getConnectionsCount(),
          documents: instance.getDocumentsCount(),
        }),
      );
      // Hocuspocus convention: rejecting with null stops the default response.
      throw null;
    },
  };
}
