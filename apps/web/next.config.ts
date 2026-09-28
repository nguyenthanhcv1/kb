import path from "node:path";

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { STATIC_SECURITY_HEADERS } from "./src/lib/security-headers";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  // Trace files from the monorepo root so workspace packages end up in `.next/standalone`
  // (server entry: `.next/standalone/apps/web/server.js`, see apps/web/Dockerfile).
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  reactStrictMode: true,
  poweredByHeader: false,
  // Same on every response; the CSP depends on runtime settings and is set by src/middleware.ts.
  async headers() {
    return [{ source: "/:path*", headers: [...STATIC_SECURITY_HEADERS] }];
  },
};

export default withNextIntl(nextConfig);
