#!/bin/bash
# End-to-end test of the kb-backup image (CI: .github/workflows/build-images.yml; locally after
# `docker build -f infra/backup/Dockerfile -t kb-backup:ci .`):
#   infra/backup/e2e-test.sh [image]
#
# A throwaway Supabase Postgres (same image as Supabase self-host) gets the repo migrations and a
# small fixture → `backup` to a local directory standing in for R2 (BACKUP_REMOTE) with a fresh
# age key → `check` → `restore-test` + `restore` into a new database on the same cluster → the
# restored rows equal the source. Negative cases: wrong key, existing database, stale backup.
# Needs Docker only; nothing leaves the machine.
set -euo pipefail

IMAGE=${1:-kb-backup:ci}
SUPABASE_PG_IMAGE=${SUPABASE_PG_IMAGE:-public.ecr.aws/supabase/postgres:15.8.1.085}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
RUN_ID="kb-backup-e2e-$$"
NET=$RUN_ID
DB=$RUN_ID-db
PASSWORD=e2e-not-a-secret
SRC_URL="postgresql://postgres:$PASSWORD@$DB:5432/postgres"
ADMIN_URL="postgresql://supabase_admin:$PASSWORD@$DB:5432/postgres"
REMOTE=$(mktemp -d)
# Containers run as the caller so the files in REMOTE stay removable.
AS_ME="$(id -u):$(id -g)"

step() { printf '\n=== %s\n' "$*"; }
fail() {
  printf 'E2E FAILED: %s\n' "$*" >&2
  exit 1
}
cleanup() {
  docker rm -f "$DB" > /dev/null 2>&1 || true
  docker network rm "$NET" > /dev/null 2>&1 || true
  rm -rf "$REMOTE" || true
}
trap cleanup EXIT

# kb-backup with the test environment; extra -e flags first, then the command.
kb() {
  local envs=()
  while [ "${1:-}" = -e ]; do
    envs+=(-e "$2")
    shift 2
  done
  docker run --rm --network "$NET" --user "$AS_ME" -v "$REMOTE:/remote" \
    -e BACKUP_REMOTE=/remote -e BACKUP_PREFIX=e2e \
    -e DATABASE_URL="$SRC_URL" -e RESTORE_ADMIN_URL="$ADMIN_URL" \
    "${envs[@]}" "$IMAGE" "$@"
}
sql() {
  docker run --rm --network "$NET" --entrypoint psql "$IMAGE" "$1" -X -q -At -v ON_ERROR_STOP=1 -c "$2"
}

step "start $SUPABASE_PG_IMAGE"
docker network create "$NET" > /dev/null
docker run -d --name "$DB" --network "$NET" -e POSTGRES_PASSWORD="$PASSWORD" "$SUPABASE_PG_IMAGE" > /dev/null
# The image initialises on a Unix socket only; TCP answers once the final server is up.
for _ in $(seq 1 90); do
  sql "$ADMIN_URL" "select 1" > /dev/null 2>&1 && break
  sleep 2
done
sql "$ADMIN_URL" "select 1" > /dev/null || fail "database did not start"

step "migrations + fixture"
docker run --rm --network "$NET" -v "$ROOT/supabase/migrations:/migrations:ro" --entrypoint bash "$IMAGE" -c \
  'for f in /migrations/*.sql; do psql "$0" -X -q -v ON_ERROR_STOP=1 -f "$f" > /dev/null 2>&1 || { echo "failed: $f"; exit 1; }; done' \
  "$SRC_URL"
# One real Yjs update: a paragraph "Xin chào" in the "default" fragment (kb-collab's field).
sql "$SRC_URL" "
  insert into auth.users (id, email) values
    ('00000000-0000-0000-0000-000000000001', 'admin@example.com'),
    ('00000000-0000-0000-0000-000000000002', 'editor@example.com');
  select set_config('request.jwt.claim.role', 'service_role', false);
  update public.profiles set is_guest = false;
  select set_config('request.jwt.claim.role', '', false);
  insert into public.spaces (id, slug, name, visibility, created_by) values
    ('10000000-0000-0000-0000-00000000000a', 'khong-gian', 'Không gian bí mật', 'restricted',
     '00000000-0000-0000-0000-000000000001');
  insert into public.pages (space_id, position, title, created_by)
  select '10000000-0000-0000-0000-00000000000a', 'a' || g, 'Trang ' || g, '00000000-0000-0000-0000-000000000001'
  from generate_series(1, 5) as g;
  update public.page_documents set content_text = 'Xin chào',
    ydoc = '\\x0103a8e3bf86090007010764656661756c7403097061726167726170680700a8e3bf860900060400a8e3bf8609010958696e206368c3a06f00';
" > /dev/null
SOURCE=$(sql "$SRC_URL" "select (select count(*) from public.pages) || '/' || (select count(*) from public.audit_logs) || '/' || (select md5(string_agg(encode(ydoc, 'hex'), ',' order by page_id)) from public.page_documents)")
echo "source pages/audit_logs/md5(ydoc) = $SOURCE"

step "age key pair (test only)"
KEYS=$(docker run --rm --entrypoint age-keygen "$IMAGE" 2> /dev/null)
IDENTITY=$(printf '%s\n' "$KEYS" | grep '^AGE-SECRET-KEY-')
RECIPIENT=$(printf '%s\n' "$KEYS" | sed -n 's/^# public key: //p')
OTHER_IDENTITY=$(docker run --rm --entrypoint age-keygen "$IMAGE" 2> /dev/null | grep '^AGE-SECRET-KEY-')

step "backup (daily + pre-migrate)"
kb -e BACKUP_AGE_RECIPIENT="$RECIPIENT" backup
kb -e BACKUP_AGE_RECIPIENT="$RECIPIENT" backup --kind pre-migrate --label v0.0.0-e2e
kb list
find "$REMOTE/e2e/daily" -type f | grep -Eq '/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z\.dump\.age$' || fail "no daily dump"
find "$REMOTE/e2e/daily" -type f | grep -Eq '\.roles\.sql\.age$' || fail "no daily roles file"
PRE_MIGRATE=$(basename "$(find "$REMOTE/e2e/pre-migrate" -type f -name 'v0.0.0-e2e-*.dump.age')" .dump.age)
[ -n "$PRE_MIGRATE" ] || fail "no pre-migrate dump"
if grep -rqa -e 'Không gian bí mật' -e 'admin@example.com' -e 'CREATE ROLE' "$REMOTE"; then
  fail "plain text found in the uploaded files"
fi
if kb -e BACKUP_AGE_RECIPIENT="$RECIPIENT" backup --kind pre-migrate --label '../x' 2> /dev/null; then
  fail "a label with a slash was accepted"
fi

step "check (freshness)"
kb check
if kb -e BACKUP_MAX_AGE_HOURS=0 check 2> /dev/null; then fail "check passed with a 0 h limit"; fi

step "restore-test"
SUMMARY=$(kb -e BACKUP_AGE_IDENTITY="$IDENTITY" -e RESTORE_TEST_MIN_PAGES=5 restore-test | tail -n 1)
echo "$SUMMARY"
echo "$SUMMARY" | grep -q '"pages" : 5' || fail "restore-test summary: $SUMMARY"
[ "$(sql "$ADMIN_URL" "select count(*) from pg_database where datname = 'kb_restore_test'")" = 0 ] \
  || fail "restore-test left its database behind"
if kb -e BACKUP_AGE_IDENTITY="$IDENTITY" -e RESTORE_TEST_MIN_PAGES=6 restore-test > /dev/null 2>&1; then
  fail "restore-test passed with too few pages"
fi

step "restore (wrong key → refused, then right key)"
if kb -e BACKUP_AGE_IDENTITY="$OTHER_IDENTITY" restore --db kb_restore 2> /dev/null; then
  fail "restore worked with another key"
fi
kb -e BACKUP_AGE_IDENTITY="$IDENTITY" restore --db kb_restore
RESTORED_URL="postgresql://supabase_admin:$PASSWORD@$DB:5432/kb_restore"
RESTORED=$(sql "$RESTORED_URL" "select (select count(*) from public.pages) || '/' || (select count(*) from public.audit_logs) || '/' || (select md5(string_agg(encode(ydoc, 'hex'), ',' order by page_id)) from public.page_documents)")
echo "restored pages/audit_logs/md5(ydoc) = $RESTORED"
[ "$RESTORED" = "$SOURCE" ] || fail "restored data differs from the source"
[ "$(sql "$ADMIN_URL" "select pg_get_userbyid(datdba) from pg_database where datname = 'kb_restore'")" = postgres ] \
  || fail "restored database is not owned like the cluster's postgres database"
if kb -e BACKUP_AGE_IDENTITY="$IDENTITY" restore --db kb_restore 2> /dev/null; then
  fail "restore overwrote an existing database without --replace"
fi
if kb -e BACKUP_AGE_IDENTITY="$IDENTITY" restore --db postgres 2> /dev/null; then
  fail "restore accepted the live database name"
fi
kb -e BACKUP_AGE_IDENTITY="$IDENTITY" restore --key "pre-migrate/$PRE_MIGRATE" --db kb_restore --replace
kb export-ydoc --db kb_restore --limit 2 | grep -Eq $'^[0-9a-f-]{36}\t1\t' || fail "export-ydoc"

printf '\nE2E OK\n'
