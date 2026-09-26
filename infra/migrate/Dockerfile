# syntax=docker/dockerfile:1.7
# kb-migrate: applies supabase/migrations to a database (docs/PLAN.md §3.7, §7.2).
# Runs once per deploy inside the internal Docker network, before the new web/collab start:
#   docker run --rm -e DATABASE_URL=postgresql://postgres:...@supabase-db:5432/postgres kb-migrate
# Build from the repo root: docker build -f infra/migrate/Dockerfile -t kb-migrate .

FROM debian:bookworm-slim

# Keep in sync with supabase/README.md and .github/workflows/ci.yml.
ARG SUPABASE_CLI_VERSION=2.118.0
ARG TARGETARCH=amd64
ARG APP_VERSION=0.0.0-dev
ARG GIT_SHA=unknown

# Fetched by BuildKit (no curl in the image). The CLI is a glibc binary, hence Debian, not Alpine.
ADD https://github.com/supabase/cli/releases/download/v${SUPABASE_CLI_VERSION}/supabase_linux_${TARGETARCH}.tar.gz /tmp/supabase.tar.gz
RUN tar -xzf /tmp/supabase.tar.gz -C /usr/local/bin supabase \
 && rm /tmp/supabase.tar.gz \
 && supabase --version

LABEL org.opencontainers.image.title="kb-migrate" \
      org.opencontainers.image.source="https://github.com/nguyenthanhcv1/kb" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}"

RUN useradd --system --create-home --user-group app
WORKDIR /work
COPY --chown=app:app supabase/config.toml supabase/config.toml
COPY --chown=app:app supabase/migrations supabase/migrations
COPY --chown=app:app infra/migrate/entrypoint.sh /usr/local/bin/kb-migrate
USER app
ENV APP_VERSION=${APP_VERSION} GIT_SHA=${GIT_SHA}
ENTRYPOINT ["/usr/local/bin/kb-migrate"]
