#!/bin/sh
# Apply pending migrations (forward-only). Extra arguments are passed to `supabase db push`,
# e.g. `--dry-run` to list what would run.
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[kb-migrate] Invalid environment variables:" >&2
  echo "  - DATABASE_URL: is required" >&2
  exit 1
fi

echo "[kb-migrate] ${APP_VERSION:-unknown} (${GIT_SHA:-unknown}): applying supabase/migrations"
exec supabase db push --yes --db-url "$DATABASE_URL" --include-all "$@"
