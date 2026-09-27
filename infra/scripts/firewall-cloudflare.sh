#!/usr/bin/env bash
# Host firewall for the Coolify servers behind Cloudflare (kb-ops-1, later kb-prod-1).
# T0.8 — docs/PLAN.md §7.0, §7.3 · step by step: docs/runbooks/staging.md.
#
# Policy (inbound from the Internet; outbound and container-to-container traffic untouched):
#   - 80/443          only from Cloudflare's ranges (cloudflare-ips.sh)
#   - SSH             only from --admin CIDRs (admin IPs; kb-ops-1's IP on kb-prod-1)
#   - Coolify ports   (8000 dashboard, 6001 realtime, 6002 terminal) only from --admin CIDRs
#   - anything else   dropped — including any port a container publishes by mistake
#                     (e.g. Postgres 5432: it must never be reachable from the Internet)
#
# Two layers, because Docker-published ports (Traefik 80/443, Coolify 8000…) bypass ufw:
#   1. iptables/ip6tables chain KB-DOCKER, jumped to from DOCKER-USER, matching the ORIGINAL
#      destination port (conntrack) against ipsets kb-cf4/kb-cf6/kb-admin4/kb-admin6;
#   2. ufw for the host's own listeners (sshd, docker-proxy): default deny incoming, SSH from
#      --admin only, 80/443 from Cloudflare only.
# Rules tagged by this script are replaced on every run (idempotent); stale ones are removed.
# The Hostinger firewall (hPanel › VPS › Firewall) is the outer layer, set by hand (runbook).
#
# Keep a second SSH session open while running it the first time; the Hostinger browser
# terminal (hPanel › VPS › Overview) is the way back in if SSH gets locked out.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
readonly SCRIPT_DIR
readonly STATE_DIR=/var/lib/kb-firewall
readonly INSTALL_DIR=/usr/local/lib/kb-firewall
readonly CHAIN=KB-DOCKER

usage() {
  cat <<'EOF'
Usage: firewall-cloudflare.sh --admin CIDR [--admin CIDR]... [options]

  --admin CIDR          IPv4/IPv6 address or range allowed to use SSH and the Coolify ports
                        (repeat; at least one unless --allow-ssh-anywhere)
  --ssh-port N          SSH port (default 22)
  --coolify-ports LIST  comma-separated Docker-published ports reserved to --admin
                        (default 8000,6001,6002; "none" once Coolify is served on a domain)
  --iface NAME          public network interface (default: the one of the default route)
  --cf-ips-file FILE    use this list of Cloudflare ranges instead of downloading it
                        (path without spaces)
  --allow-ssh-anywhere  do not restrict SSH (only if SSH goes through Cloudflare Tunnel or the
                        Hostinger firewall already restricts it)
  --dry-run             print the commands instead of running them (no root needed)
  --install             also install the scripts + a systemd service/timer that re-applies
                        these same options at boot and refreshes Cloudflare's ranges weekly
EOF
}

die() {
  echo "firewall-cloudflare: $*" >&2
  exit 1
}

DRY_RUN=0
run() {
  if ((DRY_RUN)); then
    printf '+ %s\n' "$*"
  else
    "$@"
  fi
}

# Normalises a single address to a CIDR so that "1.2.3.4" and "1.2.3.4/32" compare equal.
strip_host_prefix() {
  local cidr=$1
  cidr=${cidr%/32}
  cidr=${cidr%/128}
  printf '%s' "$cidr"
}

ADMIN=()
SSH_PORT=22
COOLIFY_PORTS=8000,6001,6002
IFACE=""
CF_FILE=""
ALLOW_SSH_ANYWHERE=0
INSTALL=0
ORIGINAL_ARGS=("$@")

while (($#)); do
  case $1 in
    --admin)
      ADMIN+=("${2:?--admin needs a CIDR}")
      shift 2
      ;;
    --ssh-port)
      SSH_PORT=${2:?--ssh-port needs a value}
      shift 2
      ;;
    --coolify-ports)
      COOLIFY_PORTS=${2:?--coolify-ports needs a value (or none)}
      shift 2
      ;;
    --iface)
      IFACE=${2:?--iface needs a value}
      shift 2
      ;;
    --cf-ips-file)
      CF_FILE=${2:?--cf-ips-file needs a value}
      shift 2
      ;;
    --allow-ssh-anywhere)
      ALLOW_SSH_ANYWHERE=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --install)
      INSTALL=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

# --- validate input ---------------------------------------------------------------------------
is_port() { [[ $1 =~ ^[0-9]{1,5}$ ]] && ((10#$1 >= 1 && 10#$1 <= 65535)); }
is_port "$SSH_PORT" || die "invalid --ssh-port '$SSH_PORT'"
PORTS=()
[[ $COOLIFY_PORTS == none ]] && COOLIFY_PORTS=""
if [[ -n $COOLIFY_PORTS ]]; then
  IFS=, read -r -a PORTS <<<"$COOLIFY_PORTS"
  for port in "${PORTS[@]}"; do
    is_port "$port" || die "invalid port '$port' in --coolify-ports"
    [[ $port == 80 || $port == 443 ]] && die "--coolify-ports must not contain 80/443"
  done
fi
if ((${#ADMIN[@]} == 0 && !ALLOW_SSH_ANYWHERE)); then
  die "give at least one --admin CIDR (your IP: curl -4 https://ifconfig.me), or --allow-ssh-anywhere"
fi

ADMIN4=()
ADMIN6=()
for cidr in "${ADMIN[@]}"; do
  if [[ $cidr == *:* ]]; then
    [[ $cidr =~ ^[0-9A-Fa-f:]+(/([0-9]|[1-9][0-9]|1[01][0-9]|12[0-8]))?$ ]] || die "invalid --admin '$cidr'"
    ADMIN6+=("$cidr")
  else
    [[ $cidr =~ ^(([0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])(/([0-9]|[12][0-9]|3[0-2]))?$ ]] ||
      die "invalid --admin '$cidr'"
    [[ $cidr == 0.0.0.0/0 ]] && die "--admin 0.0.0.0/0 opens everything; use --allow-ssh-anywhere if you mean it"
    ADMIN4+=("$cidr")
  fi
done

if ((!DRY_RUN)); then
  ((EUID == 0)) || die "must run as root (or use --dry-run)"
  for bin in iptables ip6tables ipset; do
    command -v "$bin" >/dev/null || die "missing '$bin' (apt-get install -y iptables ipset)"
  done
fi

# --- Cloudflare ranges ------------------------------------------------------------------------
cf_args=(--cache-dir "$STATE_DIR")
[[ -n $CF_FILE ]] && cf_args=(--input "$CF_FILE")
((DRY_RUN)) && [[ -z $CF_FILE ]] && cf_args=()
CF_LIST=$("$SCRIPT_DIR/cloudflare-ips.sh" "${cf_args[@]}") || die "could not get Cloudflare's ranges; nothing changed"
CF4=()
CF6=()
while IFS= read -r cidr; do
  if [[ $cidr == *:* ]]; then CF6+=("$cidr"); else CF4+=("$cidr"); fi
done <<<"$CF_LIST"

if [[ -z $IFACE ]]; then
  IFACE=$(ip -o route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "dev") print $(i + 1)}') || true
  [[ -n $IFACE ]] || { ((DRY_RUN)) && IFACE=eth0; } || die "cannot find the public interface; pass --iface"
fi
[[ $IFACE =~ ^[A-Za-z0-9_.@-]+$ ]] || die "invalid --iface '$IFACE'"

echo "firewall-cloudflare: iface=$IFACE cloudflare=${#CF4[@]}+${#CF6[@]} admin=${#ADMIN[@]} ssh=$SSH_PORT coolify=${COOLIFY_PORTS:-none}" >&2

# --- ipsets (replaced atomically with swap) ---------------------------------------------------
# $1 name, $2 family (inet|inet6), rest: members.
sync_ipset() {
  local name=$1 family=$2
  shift 2
  run ipset create -exist "$name" hash:net family "$family"
  run ipset create -exist "$name-new" hash:net family "$family"
  run ipset flush "$name-new"
  local cidr
  for cidr in "$@"; do
    run ipset add -exist "$name-new" "$cidr"
  done
  run ipset swap "$name-new" "$name"
  run ipset destroy "$name-new"
}

sync_ipset kb-cf4 inet "${CF4[@]}"
sync_ipset kb-cf6 inet6 "${CF6[@]}"
sync_ipset kb-admin4 inet "${ADMIN4[@]}"
sync_ipset kb-admin6 inet6 "${ADMIN6[@]}"

# --- Docker-published ports: chain KB-DOCKER from DOCKER-USER ---------------------------------
# $1 iptables|ip6tables, $2 ipset suffix (4|6)
docker_chain() {
  local ipt=$1 v=$2 port
  if ((!DRY_RUN)) && ! "$ipt" -w -n -L DOCKER-USER >/dev/null 2>&1; then
    echo "firewall-cloudflare: $ipt has no DOCKER-USER chain (Docker not running or IPv6 off) — skipped" >&2
    return 0
  fi
  if ((DRY_RUN)) || ! "$ipt" -w -n -L "$CHAIN" >/dev/null 2>&1; then
    run "$ipt" -w -N "$CHAIN"
  fi
  run "$ipt" -w -F "$CHAIN"
  # Only traffic arriving on the public interface; replies to outbound connections pass.
  run "$ipt" -w -A "$CHAIN" ! -i "$IFACE" -j RETURN
  run "$ipt" -w -A "$CHAIN" -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
  for port in 80 443; do
    run "$ipt" -w -A "$CHAIN" -p tcp -m conntrack --ctorigdstport "$port" --ctdir ORIGINAL \
      -m set --match-set "kb-cf$v" src -j RETURN
  done
  for port in "${PORTS[@]}"; do
    run "$ipt" -w -A "$CHAIN" -p tcp -m conntrack --ctorigdstport "$port" --ctdir ORIGINAL \
      -m set --match-set "kb-admin$v" src -j RETURN
  done
  run "$ipt" -w -A "$CHAIN" -m conntrack --ctstate NEW,INVALID -j DROP
  if ((DRY_RUN)) || ! "$ipt" -w -C DOCKER-USER -j "$CHAIN" >/dev/null 2>&1; then
    run "$ipt" -w -I DOCKER-USER 1 -j "$CHAIN"
  fi
}

docker_chain iptables 4
docker_chain ip6tables 6

# --- ufw: the host's own listeners (sshd) -----------------------------------------------------
# Deletes the ufw rules carrying comment $1 whose source is not in the remaining arguments.
prune_ufw() {
  local comment=$1
  shift
  local keep=" " cidr
  for cidr in "$@"; do keep+="$(strip_host_prefix "$cidr") "; done
  local numbers
  numbers=$(ufw status numbered | awk -v tag="# $comment" -v keep="$keep" '
    index($0, tag) {
      n = $0; sub(/^\[ */, "", n); sub(/\].*/, "", n)
      line = substr($0, 1, index($0, tag) - 1)
      k = split(line, f, " "); src = f[k]
      sub(/\/(32|128)$/, "", src)
      if (index(keep, " " src " ") == 0) print n
    }' | sort -rn)
  local number
  for number in $numbers; do
    run ufw --force delete "$number"
  done
}

if command -v ufw >/dev/null || ((DRY_RUN)); then
  run ufw default deny incoming
  run ufw default allow outgoing
  for cidr in "${ADMIN[@]}"; do
    run ufw allow proto tcp from "$cidr" to any port "$SSH_PORT" comment kb-admin-ssh
  done
  if ((ALLOW_SSH_ANYWHERE)); then
    run ufw limit "$SSH_PORT/tcp" comment kb-ssh-anywhere
  fi
  # For 80/443 answered by a host process (e.g. docker-proxy for IPv6) rather than DNAT.
  for cidr in "${CF4[@]}" "${CF6[@]}"; do
    run ufw allow proto tcp from "$cidr" to any port 80,443 comment kb-cloudflare
  done
  if ((!DRY_RUN)); then
    prune_ufw kb-admin-ssh "${ADMIN[@]}"
    prune_ufw kb-cloudflare "${CF4[@]}" "${CF6[@]}"
    ((ALLOW_SSH_ANYWHERE)) || prune_ufw kb-ssh-anywhere
  fi
  run ufw --force enable
else
  echo "firewall-cloudflare: ufw not installed — host listeners (sshd) rely on the Hostinger firewall" >&2
fi

# --- persistence ------------------------------------------------------------------------------
if ((INSTALL)); then
  [[ -n $CF_FILE ]] && echo "firewall-cloudflare: warning: --cf-ips-file is saved too, the weekly refresh will not download new ranges" >&2
  # Every value was validated above (CIDRs, ports, interface name): no spaces, no quoting.
  args=()
  for arg in "${ORIGINAL_ARGS[@]}"; do
    [[ $arg == --install || $arg == --dry-run ]] && continue
    [[ $arg == *[[:space:]\"\'\\]* ]] && die "argument '$arg' cannot be saved for the service"
    args+=("$arg")
  done
  run install -d -m 0755 "$INSTALL_DIR" "$STATE_DIR"
  run install -m 0755 "$SCRIPT_DIR/firewall-cloudflare.sh" "$SCRIPT_DIR/cloudflare-ips.sh" "$INSTALL_DIR/"
  if ((DRY_RUN)); then
    echo "+ write /etc/default/kb-firewall: KB_FIREWALL_ARGS=\"${args[*]}\""
    echo "+ write /etc/systemd/system/kb-firewall.service kb-firewall.timer"
  else
    echo "KB_FIREWALL_ARGS=\"${args[*]}\"" >/etc/default/kb-firewall
    cat >/etc/systemd/system/kb-firewall.service <<EOF
[Unit]
Description=kb firewall (Cloudflare-only 80/443, admin-only SSH/Coolify) — infra/scripts/firewall-cloudflare.sh
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=/etc/default/kb-firewall
# systemd splits \$KB_FIREWALL_ARGS on whitespace into separate arguments.
ExecStart=$INSTALL_DIR/firewall-cloudflare.sh \$KB_FIREWALL_ARGS

[Install]
WantedBy=multi-user.target
EOF
    cat >/etc/systemd/system/kb-firewall.timer <<'EOF'
[Unit]
Description=Refresh Cloudflare ranges in the kb firewall weekly

[Timer]
OnCalendar=weekly
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
EOF
  fi
  run systemctl daemon-reload
  run systemctl enable kb-firewall.service kb-firewall.timer
  run systemctl start kb-firewall.timer
fi

echo "firewall-cloudflare: done" >&2
