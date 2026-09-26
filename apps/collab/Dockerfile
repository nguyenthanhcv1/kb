# syntax=docker/dockerfile:1.7
# kb-collab: Hocuspocus server (docs/PLAN.md §7.2). Build from the repo root:
#   docker build -f apps/collab/Dockerfile --build-arg APP_VERSION=0.1.0 --build-arg GIT_SHA=$(git rev-parse HEAD) -t kb-collab .

ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS base
RUN corepack enable
ENV TURBO_TELEMETRY_DISABLED=1

FROM base AS pruner
WORKDIR /repo
COPY . .
RUN pnpm dlx turbo@2.11.4 prune @kb/collab --docker

FROM base AS builder
WORKDIR /repo
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter=@kb/collab \
 && pnpm --filter @kb/collab deploy --prod --legacy /out

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ARG APP_VERSION=0.0.0-dev
ARG GIT_SHA=unknown
ENV NODE_ENV=production PORT=3001 APP_VERSION=${APP_VERSION} GIT_SHA=${GIT_SHA}
LABEL org.opencontainers.image.title="kb-collab" \
      org.opencontainers.image.source="https://github.com/nguyenthanhcv1/kb" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}"
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /out/package.json ./package.json
COPY --from=builder --chown=app:app /out/node_modules ./node_modules
COPY --from=builder --chown=app:app /repo/apps/collab/dist ./dist
USER app
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1
# SIGTERM → close connections, store documents, exit (Coolify stop grace period: 30 s).
STOPSIGNAL SIGTERM
CMD ["node", "--enable-source-maps", "dist/index.js"]
