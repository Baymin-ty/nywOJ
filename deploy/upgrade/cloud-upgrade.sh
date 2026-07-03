#!/usr/bin/env bash
# Idempotent cloud upgrade entry for online IDE + judgeProfile.
#
# Run from an already updated checkout on the deploy host:
#   deploy/upgrade/cloud-upgrade.sh
#
# The script is intentionally configurable instead of assuming one process
# manager. See docs/cloud-upgrade.md for the shortest path and all variables.
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
SERVER_DIR="$REPO_ROOT/server"
WEB_DIR="$REPO_ROOT/web"
RUST_SANDBOX_DIR="$REPO_ROOT/deploy/rust-sandbox"

APP_PORT="${NYWOJ_APP_PORT:-1234}"
SANDBOX_PORT="${RUST_SANDBOX_PORT:-${GOJUDGE_PORT:-5050}}"
SANDBOX_HOST="${RUST_SANDBOX_HOST:-${GOJUDGE_HOST:-127.0.0.1}}"
SANDBOX_PROBE_HOST="$SANDBOX_HOST"
if [ "$SANDBOX_PROBE_HOST" = "0.0.0.0" ]; then SANDBOX_PROBE_HOST="127.0.0.1"; fi

RUN_DEPS="${NYWOJ_INSTALL_DEPS:-1}"
RUN_DB="${NYWOJ_UPGRADE_DB:-1}"
APPLY_PROFILE="${NYWOJ_APPLY_PROFILE_MIGRATION:-1}"
RUN_AUDIT="${NYWOJ_AUDIT_PROFILES:-1}"
RUN_SANDBOX="${NYWOJ_UPGRADE_SANDBOX:-${NYWOJ_UPGRADE_GOJUDGE:-1}}"
BUILD_WEB="${NYWOJ_BUILD_WEB:-1}"
RESTART_SERVICES="${NYWOJ_RESTART_SERVICES:-1}"
RUN_HEALTH="${NYWOJ_HEALTH_CHECK:-1}"
BACKUP_DB="${NYWOJ_BACKUP_DB:-0}"
BACKUP_DIR="${NYWOJ_BACKUP_DIR:-$REPO_ROOT/deploy/backups}"

BACKEND_SERVICE="${NYWOJ_BACKEND_SERVICE:-}"
BACKEND_RESTART_CMD="${NYWOJ_BACKEND_RESTART_CMD:-}"
FRONTEND_RESTART_CMD="${NYWOJ_FRONTEND_RESTART_CMD:-}"
PROXY_RELOAD_CMD="${NYWOJ_PROXY_RELOAD_CMD:-}"
PUBLIC_URL="${NYWOJ_PUBLIC_URL:-}"

usage() {
  cat <<'EOF'
Usage: deploy/upgrade/cloud-upgrade.sh [options]

Options:
  --skip-deps            Skip npm install and comparer build
  --skip-db              Skip SQL migrations
  --skip-profile         Skip judgeProfile backfill
  --skip-audit           Skip profile health audit
  --skip-sandbox         Skip Rust sandbox image/container upgrade
  --skip-web             Skip web install/build
  --skip-restart         Skip backend/proxy restart hooks
  --skip-health          Skip local health checks
  --backup-db            Dump the configured MySQL database before migrations
  -h, --help             Show this help

Common environment:
  REPO_ROOT=/path/to/nywOJ
  RUST_SANDBOX_HOST=127.0.0.1
  RUST_SANDBOX_PORT=5050
  RUST_SANDBOX_IMAGE=nywoj-rust-sandbox:latest
  NYWOJ_BACKEND_SERVICE=nywoj.service
  NYWOJ_BACKEND_RESTART_CMD='pm2 reload nywoj-server --update-env'
  NYWOJ_PROXY_RELOAD_CMD='nginx -t && systemctl reload nginx'
  NYWOJ_PUBLIC_URL=https://oj.example.com
  NYWOJ_BACKUP_DB=1
  NYWOJ_BACKUP_DIR=/var/backups/nywoj
EOF
}

while [ "${1:-}" ]; do
  case "$1" in
    --skip-deps) RUN_DEPS=0 ;;
    --skip-db) RUN_DB=0 ;;
    --skip-profile) APPLY_PROFILE=0 ;;
    --skip-audit) RUN_AUDIT=0 ;;
    --skip-sandbox) RUN_SANDBOX=0 ;;
    --skip-web) BUILD_WEB=0 ;;
    --skip-restart) RESTART_SERVICES=0 ;;
    --skip-health) RUN_HEALTH=0 ;;
    --backup-db) BACKUP_DB=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

log() { printf '\n==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
warn() { printf '!!  %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

need_file() {
  [ -f "$1" ] || die "missing required file: $1"
}

node_config() {
  local key="$1"
  node - "$SERVER_DIR/config.json" "$key" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const key = process.argv[3];
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
let cur = config;
for (const part of key.split('.')) cur = cur && cur[part];
if (cur === undefined || cur === null) process.exit(2);
process.stdout.write(String(cur));
NODE
}

npm_install() {
  local dir="$1"
  local omit_dev="${2:-0}"
  (
    cd "$dir"
    if [ -f package-lock.json ]; then
      if [ "$omit_dev" = "1" ]; then
        npm ci --omit=dev
      else
        npm ci
      fi
    else
      if [ "$omit_dev" = "1" ]; then
        npm install --omit=dev
      else
        npm install
      fi
    fi
  )
}

mysql_run_file() {
  local sql="$1"
  local db_host db_port db_user db_pass db_name
  db_host="$(node_config DB.host)"
  db_port="$(node_config DB.port)"
  db_user="$(node_config DB.username)"
  db_pass="$(node_config DB.password)"
  db_name="$(node_config DB.databasename)"

  note "mysql < ${sql#$REPO_ROOT/}"
  MYSQL_PWD="$db_pass" mysql \
    --default-character-set=utf8mb4 \
    -h "$db_host" -P "$db_port" -u "$db_user" "$db_name" < "$sql"
}

backup_db() {
  local db_host db_port db_user db_pass db_name out
  db_host="$(node_config DB.host)"
  db_port="$(node_config DB.port)"
  db_user="$(node_config DB.username)"
  db_pass="$(node_config DB.password)"
  db_name="$(node_config DB.databasename)"
  mkdir -p "$BACKUP_DIR"
  out="$BACKUP_DIR/${db_name}-before-ide-profile-$(date +%Y%m%d-%H%M%S).sql"
  MYSQL_PWD="$db_pass" mysqldump \
    --default-character-set=utf8mb4 \
    -h "$db_host" -P "$db_port" -u "$db_user" "$db_name" > "$out"
  chmod 600 "$out"
  note "database backup: $out"
}

restart_backend() {
  if [ -n "$BACKEND_RESTART_CMD" ]; then
    note "backend restart: $BACKEND_RESTART_CMD"
    (cd "$REPO_ROOT" && bash -lc "$BACKEND_RESTART_CMD")
    return
  fi

  if [ -n "$BACKEND_SERVICE" ]; then
    note "backend restart: systemctl restart $BACKEND_SERVICE"
    systemctl restart "$BACKEND_SERVICE"
    return
  fi

  if have pm2; then
    for name in nywoj-server nywoj server app; do
      if pm2 describe "$name" >/dev/null 2>&1; then
        note "backend restart: pm2 reload $name --update-env"
        (cd "$SERVER_DIR" && pm2 reload "$name" --update-env)
        return
      fi
    done
  fi

  warn "backend was not restarted; set NYWOJ_BACKEND_SERVICE or NYWOJ_BACKEND_RESTART_CMD"
}

reload_proxy() {
  if [ -n "$FRONTEND_RESTART_CMD" ]; then
    note "frontend restart: $FRONTEND_RESTART_CMD"
    (cd "$REPO_ROOT" && bash -lc "$FRONTEND_RESTART_CMD")
  fi

  if [ -n "$PROXY_RELOAD_CMD" ]; then
    note "proxy reload: $PROXY_RELOAD_CMD"
    (cd "$REPO_ROOT" && bash -lc "$PROXY_RELOAD_CMD")
    return
  fi

  if have nginx; then
    note "proxy reload: nginx -t && reload"
    nginx -t
    if have systemctl && systemctl list-unit-files nginx.service >/dev/null 2>&1; then
      systemctl reload nginx || nginx -s reload
    else
      nginx -s reload
    fi
  else
    warn "proxy was not reloaded; install/reload nginx manually or set NYWOJ_PROXY_RELOAD_CMD"
  fi
}

probe_ws_upgrade() {
  local url="$1"
  local status
  status="$(curl -ksS -o /dev/null -w '%{http_code}' \
    -H 'Connection: Upgrade' \
    -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' \
    -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
    "$url" || true)"
  case "$status" in
    101|401) note "WS upgrade reached backend ($url -> HTTP $status)" ;;
    *) warn "WS upgrade probe got HTTP $status for $url; check reverse proxy Upgrade headers" ;;
  esac
}

log "preflight"
need_file "$SERVER_DIR/config.json"
need_file "$SERVER_DIR/db/add_judgeProfile.sql"
need_file "$SERVER_DIR/db/add_solVisible.sql"
need_file "$RUST_SANDBOX_DIR/build.sh"
have node || die "node is required"
have npm || die "npm is required"
if [ "$RUN_DB" = "1" ]; then have mysql || die "mysql client is required for DB migrations"; fi
if [ "$BACKUP_DB" = "1" ] && [ "$RUN_DB" = "1" ]; then have mysqldump || die "mysqldump is required for NYWOJ_BACKUP_DB=1"; fi
if [ "$RUN_SANDBOX" = "1" ]; then have docker || die "docker is required for Rust sandbox upgrade"; fi
note "repo: $REPO_ROOT"
note "Rust sandbox target: $SANDBOX_HOST:$SANDBOX_PORT"

if [ "$RUN_DEPS" = "1" ]; then
  log "install backend dependencies and build comparer"
  npm_install "$SERVER_DIR" 1
  (cd "$SERVER_DIR/comparer" && make)
fi

if [ "$RUN_DB" = "1" ]; then
  if [ "$BACKUP_DB" = "1" ]; then
    log "backup database"
    backup_db
  fi

  log "apply idempotent database migrations"
  mysql_run_file "$SERVER_DIR/db/add_judgeProfile.sql"
  mysql_run_file "$SERVER_DIR/db/add_solVisible.sql"
fi

if [ "$APPLY_PROFILE" = "1" ]; then
  log "backfill judgeProfile for type-only problems"
  (cd "$SERVER_DIR" && node db/migrate_profiles.js --apply)
else
  note "skip judgeProfile backfill"
fi

if [ "$RUN_AUDIT" = "1" ]; then
  log "audit judgeProfile health"
  if ! (cd "$SERVER_DIR" && node db/audit_profiles.js --bad); then
    cat >&2 <<'EOF'

Profile audit failed. Fix the listed problem assets/profile errors before
restarting the upgraded worker.

EOF
    exit 1
  fi
fi

if [ "$RUN_SANDBOX" = "1" ]; then
  log "upgrade Rust sandbox"
  (cd "$REPO_ROOT" && RUST_SANDBOX_HOST="$SANDBOX_HOST" RUST_SANDBOX_PORT="$SANDBOX_PORT" "$RUST_SANDBOX_DIR/build.sh" --deploy)
fi

if [ "$BUILD_WEB" = "1" ]; then
  log "install frontend dependencies and build web/dist"
  npm_install "$WEB_DIR" 0
  (cd "$WEB_DIR" && npm run build)
fi

if [ "$RESTART_SERVICES" = "1" ]; then
  log "restart services"
  restart_backend
  reload_proxy
fi

if [ "$RUN_HEALTH" = "1" ]; then
  log "health checks"
  curl -fsS "http://${SANDBOX_PROBE_HOST}:${SANDBOX_PORT}/api/version" >/dev/null
  note "sandbox /api/version OK"
  curl -fsS -X POST -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:${APP_PORT}/api/common/getAnnouncementList" >/dev/null || \
    warn "backend REST probe failed on 127.0.0.1:${APP_PORT}"
  probe_ws_upgrade "http://127.0.0.1:${APP_PORT}/api/ide/stream"
  if [ -n "$PUBLIC_URL" ]; then
    probe_ws_upgrade "${PUBLIC_URL%/}/api/ide/stream"
  else
    warn "set NYWOJ_PUBLIC_URL=https://your-domain to probe public WebSocket reverse proxy"
  fi
fi

log "upgrade finished"
note "If this host is only a remote judge worker, run with --skip-db --skip-web and restart that worker service too."
