#!/bin/bash
# kb-backup — Postgres backup to Cloudflare R2, encrypted with age (docs/PLAN.md §7.8,
# runbook docs/runbooks/backup-restore.md).
#
#   kb-backup schedule                    cron (supercronic): BACKUP_SCHEDULE → `backup` (default command)
#   kb-backup backup [--kind pre-migrate --label v0.2.0]
#                                         pg_dump -Fc + roles → age → R2 <prefix>/<tier>/<UTC time>.*.age
#   kb-backup list [tier]                 objects in R2 (tier: daily | weekly | monthly | pre-migrate)
#   kb-backup check                       newest daily backup younger than BACKUP_MAX_AGE_HOURS (26)?
#   kb-backup restore [--key latest|<tier>/<name>] [--tier daily] [--db kb_restore] [--replace]
#                                         download → decrypt → roles + pg_restore into a NEW database
#   kb-backup restore-test [--keep]       restore the newest daily into a scratch database, run
#                                         verify.sql, drop it again (monthly job)
#   kb-backup export-ydoc [--db NAME] [--limit 20]
#                                         print "page_id<TAB>has_text<TAB>base64 ydoc" of random
#                                         pages (input of scripts/backup/verify-ydoc.mjs)
#   kb-backup healthcheck                 Docker HEALTHCHECK: last success < BACKUP_MAX_AGE_HOURS
#
# Environment: infra/backup/env.example. Secrets are only read from the environment and are never
# printed; logs name hosts, prefixes and object names only.
set -euo pipefail

LIB=${KB_BACKUP_LIB:-/usr/local/lib/kb-backup/lib.sh}
[ -f "$LIB" ] || LIB="$(dirname "$0")/lib.sh"
# shellcheck source=infra/backup/lib.sh
. "$LIB"

SHARE=${KB_BACKUP_SHARE:-/usr/local/share/kb-backup}
[ -f "$SHARE/verify.sql" ] || SHARE="$(dirname "$0")"
STATE_DIR=${KB_BACKUP_STATE_DIR:-/tmp/kb-backup-state}
MAX_AGE_HOURS=${BACKUP_MAX_AGE_HOURS:-26}
# pg_graphql creates graphql_public.graphql() from an event trigger, so the dump's GRANT on it runs
# before the function exists in a new database. Nothing else is skipped; extend with
# RESTORE_TOC_EXCLUDE (extended regex over `pg_restore --list` lines) only after reading the error.
TOC_EXCLUDE='ACL graphql_public FUNCTION graphql\('
[ -z "${RESTORE_TOC_EXCLUDE:-}" ] || TOC_EXCLUDE="$TOC_EXCLUDE|$RESTORE_TOC_EXCLUDE"

WORK=""
FAIL_URL=""
cleanup() {
  rc=$?
  [ -z "$WORK" ] || rm -rf "$WORK"
  if [ "$rc" -ne 0 ] && [ -n "$FAIL_URL" ]; then heartbeat "$FAIL_URL"; fi
  exit "$rc"
}
trap cleanup EXIT

workdir() {
  [ -n "$WORK" ] && return 0
  WORK=$(mktemp -d "${BACKUP_WORK_DIR:-/tmp}/kb-backup.XXXXXX")
  chmod 700 "$WORK"
}

# heartbeat URL — GET a monitoring URL (Uptime Kuma push monitor, healthchecks.io, …). A failing
# monitor must not fail the backup itself; the monitor alerts on the missing ping anyway.
heartbeat() {
  [ -n "${1:-}" ] || return 0
  curl -fsS -m 15 --retry 3 -o /dev/null "$1" || log "WARNING: heartbeat request failed"
}

# Destination root: an rclone remote built from S3_* (Cloudflare R2), or BACKUP_REMOTE (any rclone
# path, e.g. a local directory in tests / a second provider).
setup_remote() {
  if [ -n "${BACKUP_REMOTE:-}" ]; then
    ROOT=$BACKUP_REMOTE
  else
    require_env S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY
    export RCLONE_CONFIG_R2_TYPE=s3
    export RCLONE_CONFIG_R2_PROVIDER="${S3_PROVIDER:-Cloudflare}"
    export RCLONE_CONFIG_R2_ENDPOINT="$S3_ENDPOINT"
    export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$S3_ACCESS_KEY"
    export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$S3_SECRET_KEY"
    export RCLONE_CONFIG_R2_REGION="${S3_REGION:-auto}"
    export RCLONE_CONFIG_R2_ACL=private
    # The R2 token is scoped to one bucket: never try to list/create buckets.
    export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
    ROOT="r2:$S3_BUCKET"
  fi
  PREFIX=$(safe_label "${BACKUP_PREFIX:-prod}") || die "BACKUP_PREFIX must match [A-Za-z0-9._-]"
  # No config file: everything comes from the environment.
  export RCLONE_CONFIG=/dev/null
}

rc() {
  rclone --quiet --retries 5 --low-level-retries 10 "$@"
}

latest_in() {
  rc lsf --files-only "$ROOT/$PREFIX/$1/" | latest_backup || true
}

# Sets ID to a file holding the age identity (private key): BACKUP_AGE_IDENTITY_FILE, or the
# content of BACKUP_AGE_IDENTITY written to the private work directory.
load_identity() {
  workdir
  if [ -n "${BACKUP_AGE_IDENTITY_FILE:-}" ]; then
    [ -r "$BACKUP_AGE_IDENTITY_FILE" ] || die "BACKUP_AGE_IDENTITY_FILE is not readable"
    ID=$BACKUP_AGE_IDENTITY_FILE
  else
    require_env BACKUP_AGE_IDENTITY
    (umask 077 && printf '%s\n' "$BACKUP_AGE_IDENTITY" > "$WORK/identity")
    ID=$WORK/identity
  fi
}

# ---------------------------------------------------------------------------------------------
cmd_backup() {
  local kind=daily label="" tiers name recipients=() first tier file
  while [ $# -gt 0 ]; do
    case "$1" in
      --kind) kind=${2:-}; shift 2 ;;
      --label) label=${2:-}; shift 2 ;;
      *) die "backup: unknown argument $1" ;;
    esac
  done
  FAIL_URL=${BACKUP_HEARTBEAT_FAIL_URL:-}
  require_env DATABASE_URL BACKUP_AGE_RECIPIENT
  setup_remote
  for r in ${BACKUP_AGE_RECIPIENT//,/ }; do recipients+=(-r "$r"); done

  local now
  now=$(date +%s)
  name=$(backup_name "$now")
  case "$kind" in
    daily) tiers=$(backup_tiers "$now") ;;
    pre-migrate)
      label=$(safe_label "$label") || die "--kind pre-migrate needs --label [A-Za-z0-9._-] (e.g. the version)"
      name="$label-$name"
      tiers=pre-migrate
      ;;
    *) die "--kind must be daily or pre-migrate" ;;
  esac

  workdir
  log "dump of $(url_host "$DATABASE_URL") → $PREFIX/{$(printf '%s' "$tiers" | tr '\n' ,)}/$name"
  # Plain text never touches the disk: pg_dump | age. pipefail makes a pg_dump error fatal.
  pg_dumpall --roles-only --no-role-passwords --dbname="$DATABASE_URL" \
    | age "${recipients[@]}" -o "$WORK/$name.roles.sql.age"
  pg_dump --format=custom --lock-wait-timeout=120s --no-password --dbname="$DATABASE_URL" \
    | age "${recipients[@]}" -o "$WORK/$name.dump.age"
  for file in "$WORK/$name.roles.sql.age" "$WORK/$name.dump.age"; do
    [ "$(wc -c < "$file")" -gt 200 ] || die "$(basename "$file") is suspiciously small"
  done
  log "encrypted: dump $(wc -c < "$WORK/$name.dump.age") bytes, roles $(wc -c < "$WORK/$name.roles.sql.age") bytes"

  # The .dump.age object is uploaded last: its presence marks a complete backup.
  first=""
  for tier in $tiers; do
    for file in roles.sql.age dump.age; do
      if [ -z "$first" ]; then
        rc copyto "$WORK/$name.$file" "$ROOT/$PREFIX/$tier/$name.$file"
      else
        rc copyto "$ROOT/$PREFIX/$first/$name.$file" "$ROOT/$PREFIX/$tier/$name.$file"
      fi
    done
    first=${first:-$tier}
    log "uploaded $PREFIX/$tier/$name.dump.age"
  done
  [ "$(latest_in "$first")" = "$name" ] || die "uploaded object not found when listing $PREFIX/$first/"

  if [ -n "${BACKUP_STORAGE_DIR:-}" ]; then
    # Attachments (Supabase Storage file backend): copy, never delete, so a file removed or
    # damaged on the server stays in R2.
    [ -d "$BACKUP_STORAGE_DIR" ] || die "BACKUP_STORAGE_DIR is not a directory"
    rc copy "$BACKUP_STORAGE_DIR" "$ROOT/$PREFIX/storage"
    log "storage files copied to $PREFIX/storage/"
  fi

  mkdir -p "$STATE_DIR" && date +%s > "$STATE_DIR/last-success"
  heartbeat "${BACKUP_HEARTBEAT_URL:-}"
  log "backup $name done"
}

cmd_list() {
  setup_remote
  if [ -n "${1:-}" ]; then
    rc lsf --files-only "$ROOT/$PREFIX/$1/" | sort
  else
    rc lsf -R --files-only "$ROOT/$PREFIX/" | grep -v '^storage/' | sort
  fi
}

cmd_check() {
  local name age
  setup_remote
  name=$(latest_in daily)
  [ -n "$name" ] || die "no backup under $PREFIX/daily/"
  age=$(age_hours "$(date +%s)" "$(name_epoch "$name")")
  [ "$age" -lt "$MAX_AGE_HOURS" ] || die "newest backup $PREFIX/daily/$name is ${age} h old (limit ${MAX_AGE_HOURS} h)"
  log "newest backup $PREFIX/daily/$name is ${age} h old (limit ${MAX_AGE_HOURS} h)"
  printf '%s\n' "$name"
}

cmd_restore() {
  local key=latest tier=daily db=${RESTORE_DB_NAME:-kb_restore} replace=0 dir name exists
  while [ $# -gt 0 ]; do
    case "$1" in
      --key) key=${2:-}; shift 2 ;;
      --tier) tier=${2:-}; shift 2 ;;
      --db) db=${2:-}; shift 2 ;;
      --replace) replace=1; shift ;;
      *) die "restore: unknown argument $1" ;;
    esac
  done
  require_env RESTORE_ADMIN_URL
  db=$(safe_db_name "$db") || die "--db must be a new lower-case database name (not postgres/template*/_supabase)"
  setup_remote
  load_identity

  if [ "$key" = latest ]; then
    dir=$tier
    name=$(latest_in "$tier")
    [ -n "$name" ] || die "no backup under $PREFIX/$tier/"
  else
    key=${key%.dump.age}
    case "$key" in
      */*) dir=${key%/*} name=${key##*/} ;;
      *) dir=$tier name=$key ;;
    esac
  fi
  log "restore $PREFIX/$dir/$name → database $db on $(url_host "$RESTORE_ADMIN_URL")"

  workdir
  rc copyto "$ROOT/$PREFIX/$dir/$name.dump.age" "$WORK/backup.dump.age"
  rc copyto "$ROOT/$PREFIX/$dir/$name.roles.sql.age" "$WORK/roles.sql.age"
  # age authenticates the ciphertext: a wrong key or a damaged object fails here.
  age -d -i "$ID" -o "$WORK/backup.dump" "$WORK/backup.dump.age"
  age -d -i "$ID" -o "$WORK/roles.sql" "$WORK/roles.sql.age"
  rm -f "$WORK/backup.dump.age" "$WORK/roles.sql.age"
  pg_restore --list "$WORK/backup.dump" > "$WORK/toc.list"
  grep -Ev "$TOC_EXCLUDE" "$WORK/toc.list" > "$WORK/toc.filtered" || true
  log "archive OK: $(grep -cv '^;' "$WORK/toc.list") entries, $(($(grep -cv '^;' "$WORK/toc.list") - $(grep -cv '^;' "$WORK/toc.filtered"))) skipped"

  exists=$(psql "$RESTORE_ADMIN_URL" -X -At -v ON_ERROR_STOP=1 -c "select count(*) from pg_database where datname = '$db'")
  if [ "$exists" != 0 ]; then
    [ "$replace" = 1 ] || die "database $db already exists (drop it, or pass --replace)"
    psql "$RESTORE_ADMIN_URL" -X -q -v ON_ERROR_STOP=1 -c "drop database \"$db\" with (force)"
    log "dropped existing database $db"
  fi

  # Roles are cluster-wide and not in pg_dump: create the missing ones (e.g. kb_collab) first.
  # Passwords are not in the backup — set them again (runbook).
  idempotent_roles < "$WORK/roles.sql" \
    | PGOPTIONS='-c client_min_messages=warning' psql "$RESTORE_ADMIN_URL" -X -q -v ON_ERROR_STOP=1 > /dev/null
  # New database with the owner, privileges and settings (app.settings.*) of the target cluster's
  # own database, so it can later replace it (runbook "Chuyển DB đã khôi phục thành DB chính").
  psql "$RESTORE_ADMIN_URL" -X -q -v ON_ERROR_STOP=1 -v db="$db" > /dev/null << 'SQL'
select format('create database %I with template template0 owner %I', :'db', pg_get_userbyid(datdba))
from pg_database where datname = current_database() \gexec
select format('alter database %I set %I to %L', :'db', split_part(cfg, '=', 1), substr(cfg, strpos(cfg, '=') + 1))
from pg_db_role_setting s, unnest(s.setconfig) as cfg
where s.setrole = 0 and s.setdatabase = (select oid from pg_database where datname = current_database()) \gexec
select format('grant %s on database %I to %s', a.privilege_type, :'db',
  case when a.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end)
from pg_database d, aclexplode(d.datacl) as a where d.datname = current_database() \gexec
SQL
  pg_restore --exit-on-error --no-password --use-list="$WORK/toc.filtered" \
    --dbname="$(url_with_db "$RESTORE_ADMIN_URL" "$db")" "$WORK/backup.dump"
  rm -f "$WORK/backup.dump" "$WORK/roles.sql"
  log "restored $PREFIX/$dir/$name into database $db"
}

cmd_restore_test() {
  local keep=0 db=${RESTORE_TEST_DB_NAME:-kb_restore_test} name age summary
  [ "${1:-}" = --keep ] && keep=1
  FAIL_URL=${RESTORE_TEST_HEARTBEAT_FAIL_URL:-}
  require_env RESTORE_ADMIN_URL
  setup_remote
  name=$(latest_in daily)
  [ -n "$name" ] || die "no backup under $PREFIX/daily/"
  age=$(age_hours "$(date +%s)" "$(name_epoch "$name")")
  cmd_restore --key "daily/$name" --db "$db" --replace
  summary=$(psql "$(url_with_db "$RESTORE_ADMIN_URL" "$db")" -X -q -At -v ON_ERROR_STOP=1 \
    -v min_pages="${RESTORE_TEST_MIN_PAGES:-0}" -f "$SHARE/verify.sql")
  [ "$keep" = 1 ] || psql "$RESTORE_ADMIN_URL" -X -q -v ON_ERROR_STOP=1 -c "drop database \"$db\" with (force)"
  [ "$age" -lt "$MAX_AGE_HOURS" ] || die "restore OK but the newest backup $name is ${age} h old (limit ${MAX_AGE_HOURS} h)"
  heartbeat "${RESTORE_TEST_HEARTBEAT_URL:-}"
  log "restore test OK: $PREFIX/daily/$name (${age} h old) $summary"
  printf '%s\n' "$summary"
}

cmd_export_ydoc() {
  local db=${RESTORE_TEST_DB_NAME:-kb_restore_test} limit=20
  while [ $# -gt 0 ]; do
    case "$1" in
      --db) db=${2:-}; shift 2 ;;
      --limit) limit=${2:-}; shift 2 ;;
      *) die "export-ydoc: unknown argument $1" ;;
    esac
  done
  require_env RESTORE_ADMIN_URL
  db=$(safe_db_name "$db") || die "--db: invalid database name"
  [[ "$limit" =~ ^[0-9]+$ ]] || die "--limit must be a number"
  psql "$(url_with_db "$RESTORE_ADMIN_URL" "$db")" -X -At -F $'\t' -v ON_ERROR_STOP=1 -c \
    "select page_id, (content_text <> '')::int, translate(encode(ydoc, 'base64'), E'\n', '')
     from public.page_documents order by random() limit $limit"
}

cmd_schedule() {
  local crontab
  require_env DATABASE_URL BACKUP_AGE_RECIPIENT
  setup_remote
  mkdir -p "$STATE_DIR"
  crontab="$STATE_DIR/crontab"
  # Times are in TZ (Asia/Ho_Chi_Minh in the image): 02:00 ICT by default (PLAN §7.8).
  printf '%s /usr/local/bin/kb-backup backup\n' "${BACKUP_SCHEDULE:-0 2 * * *}" > "$crontab"
  if [ -n "${RESTORE_TEST_SCHEDULE:-}" ]; then
    printf '%s /usr/local/bin/kb-backup restore-test\n' "$RESTORE_TEST_SCHEDULE" >> "$crontab"
  fi
  supercronic -test "$crontab" > /dev/null 2>&1 || die "invalid BACKUP_SCHEDULE / RESTORE_TEST_SCHEDULE"
  date +%s > "$STATE_DIR/started"
  log "$APP_VERSION: schedule (TZ=${TZ:-UTC}) → $PREFIX: $(tr '\n' ';' < "$crontab")"
  exec supercronic -passthrough-logs "$crontab"
}

cmd_healthcheck() {
  local since
  if [ -f "$STATE_DIR/last-success" ]; then
    since=$(cat "$STATE_DIR/last-success")
  elif [ -f "$STATE_DIR/started" ]; then
    since=$(cat "$STATE_DIR/started")
  else
    echo "not scheduled"
    exit 1
  fi
  [ "$(age_hours "$(date +%s)" "$since")" -lt "$MAX_AGE_HOURS" ] || { echo "no successful backup for ${MAX_AGE_HOURS} h"; exit 1; }
}

APP_VERSION=${APP_VERSION:-dev}
command=${1:-schedule}
[ $# -eq 0 ] || shift
case "$command" in
  schedule) cmd_schedule "$@" ;;
  backup) cmd_backup "$@" ;;
  list) cmd_list "$@" ;;
  check) cmd_check "$@" ;;
  restore) cmd_restore "$@" ;;
  restore-test) cmd_restore_test "$@" ;;
  export-ydoc) cmd_export_ydoc "$@" ;;
  healthcheck) cmd_healthcheck ;;
  help | -h | --help) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "unknown command '$command' (kb-backup help)" ;;
esac
