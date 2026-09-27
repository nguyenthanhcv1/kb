import { Server } from "@hocuspocus/server";
import { exitOnInvalidEnv } from "@kb/shared/env";

import { createAccessTokenVerifier } from "./auth";
import { createDocumentStore } from "./db";
import { type CollabEnv, loadCollabEnv } from "./env";
import { healthExtension } from "./health";
import { createLogger } from "./logger";
import { startVersionRetention } from "./retention";
import { createCollabServer } from "./server";

let env: CollabEnv;
try {
  env = loadCollabEnv();
} catch (error) {
  exitOnInvalidEnv(error);
}

const logger = createLogger(env);

const store = env.DATABASE_URL ? createDocumentStore(env.DATABASE_URL) : null;

// Without DATABASE_URL (local skeleton, image smoke test) only /health is served.
const server = store
  ? createCollabServer({
      env,
      store,
      verifyToken: createAccessTokenVerifier(env),
      logger,
    })
  : new Server({
      name: "kb-collab",
      port: env.PORT,
      quiet: true,
      stopOnSignals: true,
      extensions: [
        healthExtension(env, null),
        {
          async onAuthenticate() {
            throw Object.assign(new Error("FORBIDDEN"), { reason: "FORBIDDEN" });
          },
        },
      ],
    });

await server.listen();
if (store) startVersionRetention({ store, logger });
logger.info({ port: env.PORT, persistence: Boolean(env.DATABASE_URL) }, "listening");
