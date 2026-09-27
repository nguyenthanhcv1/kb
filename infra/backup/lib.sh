#!/bin/sh
# Shared helpers of kb-backup (sourced by kb-backup.sh; pure functions are unit-tested by
# scripts/backup/lib.test.mjs). POSIX sh + busybox/GNU date: runs in the Alpine image and on CI.
#
# Never print a database URL, an access key or the age identity: log hosts/names only.

KB_BACKUP_TZ=${KB_BACKUP_TZ:-Asia/Ho_Chi_Minh}

log() {
  printf '[kb-backup] %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

# require_env VAR... — exits listing every missing variable (same wording as kb-web/kb-collab/
# kb-migrate, the image smoke test greps it).
require_env() {
  missing=""
  for name in "$@"; do
    eval "value=\${$name:-}"
    [ -n "$value" ] || missing="$missing $name"
  done
  if [ -n "$missing" ]; then
    echo "[kb-backup] Invalid environment variables:" >&2
    for name in $missing; do echo "  - $name: is required" >&2; done
    exit 1
  fi
}

# backup_name EPOCH → 2026-09-26T190000Z (UTC). Lexicographic order = chronological order, and a
# second run on the same day gets a new name (bucket lock forbids overwriting an object).
backup_name() {
  date -u -d "@$1" +%Y-%m-%dT%H%M%SZ
}

# name_epoch NAME → epoch seconds of a name made by backup_name (any directory/prefix/suffix
# around it is ignored). Fails when NAME holds no timestamp.
name_epoch() {
  stamp=$(printf '%s\n' "$1" | sed -n 's/.*\([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\)T\([0-9]\{2\}\)\([0-9]\{2\}\)\([0-9]\{2\}\)Z.*/\1 \2:\3:\4/p')
  [ -n "$stamp" ] || return 1
  date -u -d "$stamp" +%s
}

# backup_tiers EPOCH → the prefixes a scheduled backup is stored under, one per line, decided on
# the calendar of KB_BACKUP_TZ (docs/PLAN.md §7.8): daily always, weekly on Sunday, monthly on
# the 1st. Retention per prefix is an R2 lifecycle rule (daily 14 d, weekly 8 w, monthly 12 m).
backup_tiers() {
  echo daily
  [ "$(TZ=$KB_BACKUP_TZ date -d "@$1" +%u)" = 7 ] && echo weekly
  [ "$(TZ=$KB_BACKUP_TZ date -d "@$1" +%d)" = 01 ] && echo monthly
  return 0
}

# latest_backup — reads object names (one per line, as `rclone lsf` prints them) on stdin and
# prints the newest base name (without .dump.age), ordered by the embedded UTC time (so
# `v0.10.0-…` vs `v0.9.0-…` labels do not matter). Prints nothing when there is none.
latest_backup() {
  grep -E '^[^/]*[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z\.dump\.age$' \
    | sed -E 's/^(.*([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z))\.dump\.age$/\2 \1/' \
    | sort | tail -n 1 | cut -d ' ' -f 2
}

# age_hours NOW_EPOCH THEN_EPOCH → whole hours between the two (rounded down).
age_hours() {
  echo $((($1 - $2) / 3600))
}

# safe_label TEXT → TEXT when it is a usable object name part ([A-Za-z0-9._-], ≤ 64 chars).
safe_label() {
  printf '%s' "$1" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' || return 1
  printf '%s\n' "$1"
}

# safe_db_name NAME → NAME when it is a plain lower-case identifier that restore may create/drop.
# Refuses the databases a Supabase cluster lives on.
safe_db_name() {
  printf '%s' "$1" | grep -Eq '^[a-z_][a-z0-9_]{0,62}$' || return 1
  case "$1" in
    postgres | template0 | template1 | _supabase) return 1 ;;
  esac
  printf '%s\n' "$1"
}

# url_with_db URL DB → URL pointing at database DB (query string kept).
#   postgresql://u:p@h:5432/postgres?sslmode=disable + kb_restore
#   → postgresql://u:p@h:5432/kb_restore?sslmode=disable
url_with_db() {
  case "$1" in
    *\?*) query="?${1#*\?}" base=${1%%\?*} ;;
    *) query="" base=$1 ;;
  esac
  scheme=${base%%://*}
  rest=${base#*://}
  case "$rest" in
    */*) rest=${rest%%/*} ;;
  esac
  printf '%s://%s/%s%s\n' "$scheme" "$rest" "$2" "$query"
}

# url_host URL → host[:port] only, for logs.
url_host() {
  rest=${1#*://}
  rest=${rest%%/*}
  rest=${rest%%\?*}
  printf '%s\n' "${rest##*@}"
}

# idempotent_roles — pg_dumpall --roles-only output on stdin → the same script where
# `CREATE ROLE x;` does not fail when x already exists (a fresh Supabase already has its roles;
# only ours, e.g. kb_collab, are new). Passwords are never in the dump (--no-role-passwords).
# shellcheck disable=SC2016 # $kb$ is SQL dollar quoting, not a shell expansion
idempotent_roles() {
  sed 's/^CREATE ROLE \(.*\);$/DO $kb$ BEGIN CREATE ROLE \1; EXCEPTION WHEN duplicate_object THEN NULL; END $kb$;/'
}
