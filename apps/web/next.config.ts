import path from "node:path";

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  // Trace files from the monorepo root so workspace packages end up in `.next/standalone`
  // (server entry: `.next/standalone/apps/web/server.js`, see apps/web/Dockerfile).
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  reactStrictMode: true,
  poweredByHeader: false,
};

export default withNextIntl(nextConfig);
