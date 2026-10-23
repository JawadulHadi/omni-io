#!/usr/bin/env bash
# One-command install of Omni.io on a fresh Ubuntu or Debian server (x86-64 or ARM),
# for example an Oracle Cloud Always Free VM. It installs Docker, opens ports 80 and
# 443 in the host firewall, writes deploy/.env with fresh secrets, and starts the
# whole stack behind Caddy, which gets the HTTPS certificate for --domain.
#
#   curl -fsSL https://raw.githubusercontent.com/JawadulHadi/omni-io/main/deploy/install.sh \
#     | sudo bash -s -- --domain support.duckdns.org
#
# Run it again to upgrade: it pulls the latest code and rebuilds, keeping .env and data.
set -euo pipefail

REPO=https://github.com/JawadulHadi/omni-io.git
REF=main
DIR=/opt/omni-io
DOMAIN=
GEMINI_KEY="${GEMINI_API_KEY:-}"
SIGNUP=true

usage() {
  cat <<'EOF'
Usage: sudo deploy/install.sh --domain <hostname> [options]

  --domain <host>      Public hostname pointing at this server (required)
  --gemini-key <key>   Gemini API key. Omit to be asked; leave empty for offline demo answers
  --closed-signup      Invite-only from the start (create your account another way first)
  --dir <path>         Install directory (default /opt/omni-io)
  --repo <url>         Git repository (default the public GitHub repo)
  --ref <branch>       Branch or tag (default main)
EOF
}

step() { printf '\n\033[1;34m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --gemini-key) GEMINI_KEY="${2:-}"; shift 2 ;;
    --closed-signup) SIGNUP=false; shift ;;
    --dir) DIR="${2:-}"; shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    --ref) REF="${2:-}"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "run as root: sudo bash install.sh --domain <host>"
[[ -n "$DOMAIN" ]] || { usage >&2; die "--domain is required"; }
# shellcheck source=/dev/null # the OS's own file, read for ID and VERSION_CODENAME
[[ -r /etc/os-release ]] && . /etc/os-release
[[ "${ID:-}" == ubuntu || "${ID:-}" == debian ]] || die "this script supports Ubuntu and Debian (found ${ID:-unknown})"
export DEBIAN_FRONTEND=noninteractive

# --- Packages and Docker -------------------------------------------------------

step "Installing base packages"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git openssl >/dev/null

if docker compose version >/dev/null 2>&1; then
  step "Docker is already installed ($(docker --version))"
else
  step "Installing Docker Engine and the Compose plugin"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
  systemctl enable --now docker
fi

# Building the images needs more memory than the smallest VMs have.
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
if ((mem_kb < 3000000)) && ! swapon --show | grep -q .; then
  step "Adding a 2 GB swap file (this machine has $((mem_kb / 1024)) MB of RAM)"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

# --- Host firewall --------------------------------------------------------------
# Oracle's Ubuntu images ship iptables rules that reject everything except SSH.
# (The cloud-level security list needs ports 80 and 443 opened separately.)

step "Opening ports 80 and 443 in the host firewall"
if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ufw allow 443/udp >/dev/null
fi
if command -v iptables >/dev/null; then
  for rule in "-p tcp --dport 80" "-p tcp --dport 443" "-p udp --dport 443"; do
    # shellcheck disable=SC2086 # $rule is deliberately split into arguments
    iptables -C INPUT $rule -j ACCEPT 2>/dev/null || iptables -I INPUT $rule -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null; then netfilter-persistent save >/dev/null 2>&1 || true; fi
fi

# --- Code -------------------------------------------------------------------------

if [[ -d "$DIR/.git" ]]; then
  step "Updating $DIR to the latest $REF"
  git -C "$DIR" fetch --quiet origin "$REF"
  git -C "$DIR" checkout --quiet "$REF"
  git -C "$DIR" merge --quiet --ff-only "origin/$REF"
else
  step "Downloading Omni.io into $DIR"
  git clone --quiet --branch "$REF" "$REPO" "$DIR"
fi

# --- Configuration -----------------------------------------------------------------

env_file="$DIR/deploy/.env"

# Sets KEY=VALUE in the env file, adding it if missing. Values travel through the
# environment, so characters like / + = in secrets need no escaping.
set_env() {
  K="$1" V="$2" awk 'BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"] }
    $0 ~ "^" k "=" { print k "=" v; found = 1; next } { print }
    END { if (!found) print k "=" v }' "$env_file" >"$env_file.tmp"
  mv "$env_file.tmp" "$env_file"
}

if [[ -z "$GEMINI_KEY" && ! -f "$env_file" ]] && { : </dev/tty; } 2>/dev/null; then
  printf 'Gemini API key (free at https://aistudio.google.com/apikey; leave empty for offline demo answers): ' >/dev/tty
  read -r GEMINI_KEY </dev/tty || GEMINI_KEY=
fi

if [[ -f "$env_file" ]]; then
  # Never regenerate secrets: the database role passwords are fixed at first start.
  step "Keeping the existing $env_file"
else
  step "Writing $env_file with new secrets"
  install -m 600 /dev/null "$env_file"
  cat "$DIR/deploy/.env.example" >"$env_file"
  set_env POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  set_env APP_DB_PASSWORD "$(openssl rand -hex 24)"
  set_env JWT_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
  set_env ALLOW_SIGNUP "$SIGNUP"
  set_env AI_PROVIDER fake
fi
set_env DOMAIN "$DOMAIN"
if [[ -n "$GEMINI_KEY" ]]; then
  set_env AI_PROVIDER gemini
  set_env GEMINI_API_KEY "$GEMINI_KEY"
fi
chmod 600 "$env_file"

# --- DNS --------------------------------------------------------------------------

if [[ "$DOMAIN" != localhost ]]; then
  resolved=$(getent ahostsv4 "$DOMAIN" | awk 'NR == 1 { print $1 }' || true)
  public=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
  if [[ -z "$resolved" ]]; then
    target="${public:-the public IP of this server}"
    warn "$DOMAIN doesn't resolve yet. Point it at $target; HTTPS starts working once it does."
  elif [[ -n "$public" && "$resolved" != "$public" ]]; then
    warn "$DOMAIN points to $resolved, but this server's public IP is $public. HTTPS will fail until they match."
  fi
fi

# --- Start ------------------------------------------------------------------------

step "Building and starting the stack (the first build takes a few minutes)"
cd "$DIR/deploy"
docker compose up -d --build --remove-orphans

step "Waiting for the API to report healthy"
health=
for _ in $(seq 1 60); do
  health=$(docker compose exec -T api node -e \
    "fetch('http://127.0.0.1:3000/health').then((r) => r.text()).then(console.log, () => process.exit(1))" 2>/dev/null || true)
  [[ "$health" == *'"database":"ok"'* ]] && break
  sleep 5
done
[[ "$health" == *'"database":"ok"'* ]] || die "the API didn't become healthy. Check: cd $DIR/deploy && docker compose ps && docker compose logs --tail 100"
echo "$health"

# Through Caddy, as a visitor would arrive. For a real domain this also proves the certificate.
step "Checking HTTPS"
insecure=()
[[ "$DOMAIN" == localhost ]] && insecure=(-k) # Caddy's local CA for localhost
https_ok=false
for _ in $(seq 1 12); do
  if curl -fsS "${insecure[@]}" --max-time 10 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/health" >/dev/null 2>&1; then
    https_ok=true
    break
  fi
  sleep 5
done
if [[ "$https_ok" == true ]]; then
  echo "https://$DOMAIN is serving."
else
  warn "HTTPS isn't ready yet. Caddy gets the certificate once $DOMAIN points at this server and ports 80 and 443 are open in the cloud firewall (on Oracle: the subnet's security list). It retries on its own; see: cd $DIR/deploy && sudo docker compose logs web"
fi

ai=$(awk -F= '/^AI_PROVIDER=/ { print $2 }' "$env_file")
signup=$(awk -F= '/^ALLOW_SIGNUP=/ { print $2 }' "$env_file")
cat <<EOF

$(printf '\033[1;32m')Omni.io is running: https://$DOMAIN$(printf '\033[0m')

  AI provider:  $ai$([[ "$ai" == fake ]] && echo " (offline demo answers; add a key with --gemini-key and re-run)")
  Sign-up:      $([[ "$signup" == true ]] && echo "open" || echo "invite-only")
  Settings:     $env_file

Next steps:
EOF
if [[ "$signup" == true ]]; then
  cat <<EOF
  1. Open https://$DOMAIN and create your account. You own its workspace.
  2. Close sign-up so new people need an invite link:
       sudo sed -i 's/^ALLOW_SIGNUP=.*/ALLOW_SIGNUP=false/' $env_file
       cd $DIR/deploy && sudo docker compose up -d
EOF
else
  echo "  1. Open https://$DOMAIN — new people join with invite links from Members."
fi
cat <<EOF

  Upgrade:  re-run this script (it keeps .env and your data)
  Logs:     cd $DIR/deploy && sudo docker compose logs -f api worker
  Backup:   cd $DIR/deploy && sudo docker compose exec -T postgres pg_dump -U omniio omniio | gzip > omniio-\$(date +%F).sql.gz
EOF
