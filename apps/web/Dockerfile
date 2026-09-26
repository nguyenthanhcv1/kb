# syntax=docker/dockerfile:1.7
# kb-web: Next.js standalone server (docs/PLAN.md §7.2). Build from the repo root:
#   docker build -f apps/web/Dockerfile --build-arg APP_VERSION=0.1.0 --build-arg GIT_SHA=$(git rev-parse HEAD) -t kb-web .
# Runtime configuration comes from env (validated at startup), so one image serves every environment.

ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS base
RUN corepack enable
ENV TURBO_TELEMETRY_DISABLED=1 NEXT_TELEMETRY_DISABLED=1

FROM base AS pruner
WORKDIR /repo
COPY . .
RUN pnpm dlx turbo@2.11.4 prune @kb/web --docker

FROM base AS builder
WORKDIR /repo
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
ARG APP_VERSION=0.0.0-dev
ARG GIT_SHA=unknown
ENV APP_VERSION=${APP_VERSION} GIT_SHA=${GIT_SHA}
RUN pnpm turbo run build --filter=@kb/web && mkdir -p apps/web/public

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ARG APP_VERSION=0.0.0-dev
ARG GIT_SHA=unknown
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    APP_VERSION=${APP_VERSION} GIT_SHA=${GIT_SHA}
LABEL org.opencontainers.image.title="kb-web" \
      org.opencontainers.image.source="https://github.com/nguyenthanhcv1/kb" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}"
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=app:app /repo/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
