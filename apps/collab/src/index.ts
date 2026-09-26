import { exitOnInvalidEnv } from "@kb/shared/env";
import { Server } from "@hocuspocus/server";

import { type CollabEnv, loadCollabEnv } from "./env";
import { healthExtension } from "./health";

// Auth, persistence and the internal API arrive in T3.4 / T3.7.
let env: CollabEnv;
try {
  env = loadCollabEnv();
} catch (error) {
  exitOnInvalidEnv(error);
}

const server = new Server({
  name: "kb-collab",
  port: env.PORT,
  quiet: true,
  // On SIGTERM/SIGINT Hocuspocus stops accepting connections, closes the open ones (which
  // stores every loaded document) and exits — within Coolify's 30 s stop grace period.
  stopOnSignals: true,
  extensions: [healthExtension(env)],
});

await server.listen();
console.log(`kb-collab ${env.APP_VERSION} listening on :${env.PORT}`);
