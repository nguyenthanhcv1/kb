#!/usr/bin/env bash
# Print Cloudflare's IP ranges (IPv4 then IPv6), validated — T0.8, docs/runbooks/staging.md.
#
# Used by firewall-cloudflare.sh (80/443 only from Cloudflare) and to build Traefik's
# `forwardedHeaders.trustedIPs` (real client IP in X-Forwarded-For):
#   infra/scripts/cloudflare-ips.sh --format csv
#
# Fails closed: a download that is empty, truncated or contains anything but CIDRs is rejected.
# With --cache-dir, the last good list is saved there and reused when the download fails.
set -euo pipefail

readonly URL_V4="https://www.cloudflare.com/ips-v4"
readonly URL_V6="https://www.cloudflare.com/ips-v6"
# Cloudflare publishes 15 IPv4 and 7 IPv6 ranges (2026); fewer means a broken download.
readonly MIN_V4=5
readonly MIN_V6=3

usage() {
  cat <<'EOF'
Usage: cloudflare-ips.sh [--format lines|csv] [--cache-dir DIR] [--input FILE]

  --format lines   one CIDR per line (default)
  --format csv     comma-separated, for Traefik trustedIPs
  --cache-dir DIR  save the last good list in DIR, reuse it when the download fails
  --input FILE     validate and print FILE (one CIDR per line) instead of downloading
EOF
}

is_ipv4_cidr() {
  local ip=${1%/*} prefix octet
  [[ $1 =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}(/[0-9]{1,2})?$ ]] || return 1
  if [[ $1 == */* ]]; then
    prefix=${1#*/}
    ((10#$prefix <= 32)) || return 1
  fi
  IFS=. read -r -a octets <<<"$ip"
  for octet in "${octets[@]}"; do
    ((10#$octet <= 255)) || return 1
  done
}

is_ipv6_cidr() {
  local prefix
  [[ $1 =~ ^[0-9A-Fa-f:]+(/[0-9]{1,3})?$ && $1 == *:* ]] || return 1
  if [[ $1 == */* ]]; then
    prefix=${1#*/}
    ((10#$prefix <= 128)) || return 1
  fi
}

# Reads CIDRs on stdin (blank lines and # comments ignored), prints them IPv4 first.
# Exits non-zero on an invalid line or too few ranges.
validate() {
  local line v4=() v6=()
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line%%#*}
    line=${line//[[:space:]]/}
    [[ -z $line ]] && continue
    if is_ipv4_cidr "$line"; then
      v4+=("$line")
    elif is_ipv6_cidr "$line"; then
      v6+=("$line")
    else
      echo "cloudflare-ips: invalid range '$line'" >&2
      return 1
    fi
  done
  if ((${#v4[@]} < MIN_V4 || ${#v6[@]} < MIN_V6)); then
    echo "cloudflare-ips: expected ≥ $MIN_V4 IPv4 and ≥ $MIN_V6 IPv6 ranges, got ${#v4[@]} and ${#v6[@]}" >&2
    return 1
  fi
  printf '%s\n' "${v4[@]}" "${v6[@]}"
}

download() {
  local v4 v6
  v4=$(curl -fsS --max-time 20 --retry 2 "$URL_V4") || return 1
  v6=$(curl -fsS --max-time 20 --retry 2 "$URL_V6") || return 1
  printf '%s\n%s\n' "$v4" "$v6"
}

main() {
  local format=lines cache_dir="" input="" list=""
  while (($#)); do
    case $1 in
      --format)
        format=${2:?--format needs a value}
        shift 2
        ;;
      --cache-dir)
        cache_dir=${2:?--cache-dir needs a value}
        shift 2
        ;;
      --input)
        input=${2:?--input needs a value}
        shift 2
        ;;
      -h | --help)
        usage
        return 0
        ;;
      *)
        usage >&2
        return 2
        ;;
    esac
  done
  [[ $format == lines || $format == csv ]] || {
    usage >&2
    return 2
  }

  if [[ -n $input ]]; then
    list=$(validate <"$input") || return 1
  elif list=$(download | validate); then
    if [[ -n $cache_dir ]]; then
      mkdir -p "$cache_dir"
      printf '%s\n' "$list" >"$cache_dir/cloudflare-ips.txt.tmp"
      mv "$cache_dir/cloudflare-ips.txt.tmp" "$cache_dir/cloudflare-ips.txt"
    fi
  elif [[ -n $cache_dir && -s $cache_dir/cloudflare-ips.txt ]]; then
    echo "cloudflare-ips: download failed, using $cache_dir/cloudflare-ips.txt" >&2
    list=$(validate <"$cache_dir/cloudflare-ips.txt") || return 1
  else
    echo "cloudflare-ips: download failed and no cached list" >&2
    return 1
  fi

  if [[ $format == csv ]]; then
    paste -sd, - <<<"$list"
  else
    printf '%s\n' "$list"
  fi
}

main "$@"
