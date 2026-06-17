#!/usr/bin/env bash
#
# One-click VPS deploy for CS2 Demo AI Coach.
#
# Installs Node.js and Go if missing, fetches the code, builds the Go demo
# parser, and runs the app as a systemd service. Safe to re-run (idempotent):
# a second run just pulls the latest code, rebuilds, and restarts the service.
#
# Quick start on a fresh Debian/Ubuntu VPS:
#
#   curl -fsSL https://raw.githubusercontent.com/ttvdKaori/cs2-ai-coach/main/deploy.sh -o deploy.sh
#   sudo bash deploy.sh
#
# Or, from inside an existing checkout:
#
#   sudo bash deploy.sh
#
# Override defaults with environment variables, e.g.:
#
#   sudo PORT=8080 APP_DIR=/srv/cs2coach bash deploy.sh
#
set -euo pipefail

# ---- Configuration (override via environment) -------------------------------
REPO_URL="${REPO_URL:-https://github.com/ttvdKaori/cs2-ai-coach.git}"
APP_DIR="${APP_DIR:-/opt/cs2-demo-ai-coach}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-4173}"
SERVICE_NAME="${SERVICE_NAME:-cs2-demo-ai-coach}"
NODE_MAJOR="${NODE_MAJOR:-22}"           # Node LTS major; app requires >=20
RUN_USER="${RUN_USER:-${SUDO_USER:-root}}"
# Optional integrations forwarded into the service environment:
CS2_COACH_AI_BIN="${CS2_COACH_AI_BIN:-}"
CS2_DEMO_PARSER_BIN="${CS2_DEMO_PARSER_BIN:-}"

# ---- Helpers ----------------------------------------------------------------
log()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

need_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    die "This script must run as root (use: sudo bash deploy.sh)."
  fi
}

have() { command -v "$1" >/dev/null 2>&1; }

# ---- OS detection -----------------------------------------------------------
detect_pkg() {
  if have apt-get; then echo "apt"; return; fi
  if have dnf; then echo "dnf"; return; fi
  if have yum; then echo "yum"; return; fi
  echo "unknown"
}

PKG="$(detect_pkg)"

apt_install() { DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"; }

install_base_packages() {
  log "Installing base packages (curl, git, ca-certificates, tar)"
  case "$PKG" in
    apt) apt-get update -y && apt_install curl git ca-certificates tar ;;
    dnf) dnf install -y curl git ca-certificates tar ;;
    yum) yum install -y curl git ca-certificates tar ;;
    *)   warn "Unknown package manager; assuming curl/git/tar are already present." ;;
  esac
}

# ---- Node.js ----------------------------------------------------------------
node_ok() {
  have node || return 1
  local major
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [[ "${major:-0}" -ge 20 ]]
}

install_node() {
  if node_ok; then
    log "Node.js $(node --version) already satisfies >=20"
    return
  fi
  log "Installing Node.js ${NODE_MAJOR}.x"
  case "$PKG" in
    apt)
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
      apt_install nodejs
      ;;
    dnf|yum)
      curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
      "$PKG" install -y nodejs
      ;;
    *)
      die "Cannot auto-install Node.js on this OS; install Node >=20 manually and re-run."
      ;;
  esac
  node_ok || die "Node.js install did not produce a >=20 runtime."
}

# ---- Go ---------------------------------------------------------------------
# Required Go version is derived from go.mod so it always matches the project.
required_go_version() {
  local gomod="$1"
  awk '/^go [0-9]/ { print $2; exit }' "$gomod" 2>/dev/null || true
}

go_ok() {
  have go || return 1
  local want="$1" have_ver
  have_ver="$(go env GOVERSION 2>/dev/null | sed 's/^go//')"
  [[ -z "$want" ]] && return 0
  # Accept if installed Go >= required (simple version compare).
  [[ "$(printf '%s\n%s\n' "$want" "$have_ver" | sort -V | head -1)" == "$want" ]]
}

install_go() {
  local want="$1"
  [[ -z "$want" ]] && want="1.26.2"
  if go_ok "$want"; then
    log "Go $(go env GOVERSION 2>/dev/null) already satisfies >=${want}"
    return
  fi
  local arch
  case "$(uname -m)" in
    x86_64|amd64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) die "Unsupported CPU arch for Go install: $(uname -m)" ;;
  esac
  local tarball="go${want}.linux-${arch}.tar.gz"
  log "Installing Go ${want} (${arch})"
  rm -rf /usr/local/go
  curl -fsSL "https://go.dev/dl/${tarball}" -o "/tmp/${tarball}" \
    || die "Failed to download ${tarball} from go.dev/dl"
  tar -C /usr/local -xzf "/tmp/${tarball}"
  rm -f "/tmp/${tarball}"
  ln -sf /usr/local/go/bin/go /usr/local/bin/go
  ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt
  export PATH="/usr/local/go/bin:$PATH"
  go_ok "$want" || die "Go install did not satisfy required version ${want}."
}

# ---- Code -------------------------------------------------------------------
fetch_code() {
  # If the script runs from inside a checkout, deploy that checkout in place.
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "${script_dir}/go.mod" && -f "${script_dir}/package.json" ]]; then
    APP_DIR="$script_dir"
    log "Deploying from existing checkout at ${APP_DIR}"
    return
  fi

  if [[ -d "${APP_DIR}/.git" ]]; then
    log "Updating existing checkout at ${APP_DIR}"
    git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
    git -C "$APP_DIR" reset --hard "origin/${BRANCH}"
  else
    log "Cloning ${REPO_URL} into ${APP_DIR}"
    mkdir -p "$(dirname "$APP_DIR")"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  fi
}

build_app() {
  log "Building Go demo parser"
  ( cd "$APP_DIR" && mkdir -p bin .cache/go-build \
      && GOCACHE="$APP_DIR/.cache/go-build" /usr/local/bin/go build -buildvcs=false \
           -o bin/cs2-demoparser ./cmd/demoparser ) \
    || ( cd "$APP_DIR" && mkdir -p bin .cache/go-build \
           && GOCACHE="$APP_DIR/.cache/go-build" go build -buildvcs=false \
                -o bin/cs2-demoparser ./cmd/demoparser )
  log "Parser built at ${APP_DIR}/bin/cs2-demoparser"
  # No npm install needed: the server is dependency-free.
}

# ---- systemd service --------------------------------------------------------
install_service() {
  local node_bin server_js unit
  node_bin="$(command -v node)"
  server_js="${APP_DIR}/src/server.js"
  unit="/etc/systemd/system/${SERVICE_NAME}.service"

  log "Writing systemd unit ${unit} (user=${RUN_USER}, port=${PORT})"
  {
    echo "[Unit]"
    echo "Description=CS2 Demo AI Coach"
    echo "After=network.target"
    echo ""
    echo "[Service]"
    echo "Type=simple"
    echo "User=${RUN_USER}"
    echo "WorkingDirectory=${APP_DIR}"
    echo "ExecStart=${node_bin} ${server_js}"
    echo "Environment=PORT=${PORT}"
    [[ -n "$CS2_COACH_AI_BIN" ]]    && echo "Environment=CS2_COACH_AI_BIN=${CS2_COACH_AI_BIN}"
    [[ -n "$CS2_DEMO_PARSER_BIN" ]] && echo "Environment=CS2_DEMO_PARSER_BIN=${CS2_DEMO_PARSER_BIN}"
    echo "Restart=on-failure"
    echo "RestartSec=3"
    echo "NoNewPrivileges=true"
    echo ""
    echo "[Install]"
    echo "WantedBy=multi-user.target"
  } > "$unit"

  chown -R "$RUN_USER" "$APP_DIR" || warn "Could not chown ${APP_DIR} to ${RUN_USER}"
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
  systemctl restart "$SERVICE_NAME"
}

# ---- Main -------------------------------------------------------------------
main() {
  need_root
  [[ "$PKG" == "unknown" ]] && warn "Unrecognized package manager; dependency install may be skipped."

  install_base_packages
  install_node

  fetch_code
  local want_go
  want_go="$(required_go_version "${APP_DIR}/go.mod")"
  install_go "$want_go"

  build_app

  if have systemctl; then
    install_service
    sleep 1
    log "Service status:"
    systemctl --no-pager --full status "$SERVICE_NAME" | head -12 || true
    echo
    log "Deployed. App listening on port ${PORT}."
    log "Logs:    journalctl -u ${SERVICE_NAME} -f"
    log "Restart: systemctl restart ${SERVICE_NAME}"
  else
    warn "systemd not available; start the app manually:"
    echo "  cd ${APP_DIR} && PORT=${PORT} node src/server.js"
  fi
}

main "$@"
