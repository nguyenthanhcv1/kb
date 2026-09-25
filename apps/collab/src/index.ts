import { Server } from "@hocuspocus/server";

// Skeleton Hocuspocus server. Auth, persistence, health and graceful shutdown arrive in T3.4 / T0.7.
const port = Number(process.env.PORT ?? 3001);

const server = new Server({
  name: "kb-collab",
  port,
  quiet: true,
});

await server.listen();
console.log(`kb-collab listening on :${port}`);
