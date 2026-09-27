# syntax=docker/dockerfile:1.7
# kb-backup: pg_dump → age → Cloudflare R2, restore and restore test (docs/PLAN.md §7.8,
# runbook docs/runbooks/backup-restore.md). Default command `schedule` runs the nightly backup with
# supercronic; the other commands (`backup`, `restore`, `restore-test`, `check`…) run one-shot:
#   docker run --rm --env-file backup.env ghcr.io/nguyenthanhcv1/kb-backup:main backup
# Build from the repo root: docker build -f infra/backup/Dockerfile -t kb-backup .
#
# pg_dump/pg_restore must be the same major version as the Supabase Postgres (15, supabase/config.toml
# `major_version`) and not older than its minor version: the official postgres:15 Alpine image.
# All tools are open source: PostgreSQL (PostgreSQL License), age (BSD-3-Clause), rclone (MIT),
# supercronic (MIT), curl (curl License, MIT-style).
ARG PG_IMAGE=postgres:15.19-alpine3.24
FROM ${PG_IMAGE}

ARG APP_VERSION=0.0.0-dev
ARG GIT_SHA=unknown

RUN apk add --no-cache bash curl ca-certificates tzdata 'age~1.3' 'rclone~1.74' 'supercronic~0.2' \
 && pg_dump --version && age --version && rclone version && supercronic -version

LABEL org.opencontainers.image.title="kb-backup" \
      org.opencontainers.image.source="https://github.com/nguyenthanhcv1/kb" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}"

# 0755: BuildKit applies --chmod to the directories it creates too.
COPY --chmod=0755 infra/backup/lib.sh /usr/local/lib/kb-backup/lib.sh
COPY --chmod=0755 infra/backup/verify.sql /usr/local/share/kb-backup/verify.sql
COPY --chmod=0755 infra/backup/kb-backup.sh /usr/local/bin/kb-backup

# Schedules (BACKUP_SCHEDULE) are read in this time zone; object names are UTC.
ENV TZ=Asia/Ho_Chi_Minh \
    APP_VERSION=${APP_VERSION} \
    GIT_SHA=${GIT_SHA}

# Unprivileged user of the base image (uid 70); /tmp holds the encrypted file while it uploads.
USER postgres
WORKDIR /tmp
HEALTHCHECK --interval=5m --timeout=10s --start-period=30s --retries=2 CMD ["kb-backup", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/kb-backup"]
CMD ["schedule"]
