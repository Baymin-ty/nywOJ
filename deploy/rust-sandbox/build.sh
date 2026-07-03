#!/usr/bin/env bash
set -euo pipefail

# Build and deploy nywOJ's native Rust sandbox as the judge sandbox endpoint.
# The default binding keeps the backend configuration stable: the Node judge
# workers call the sandbox API at http://127.0.0.1:5050/api/*.
#
# Usage:
#   deploy/rust-sandbox/build.sh
#   RUST_SANDBOX_HOST=127.0.0.1 RUST_SANDBOX_PORT=5050 deploy/rust-sandbox/build.sh --deploy

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${RUST_SANDBOX_IMAGE:-nywoj-rust-sandbox:latest}"
CONTAINER="${RUST_SANDBOX_CONTAINER:-nywoj-rust-sandbox}"
HOST="${RUST_SANDBOX_HOST:-127.0.0.1}"
PORT="${RUST_SANDBOX_PORT:-5050}"
PROBE_HOST="$HOST"
if [ "$PROBE_HOST" = "0.0.0.0" ]; then PROBE_HOST="127.0.0.1"; fi
RUNTIME_IMAGE="${RUST_SANDBOX_RUNTIME_IMAGE:-debian:bookworm-slim}"
INSTALL_RUNTIME_PACKAGES="${RUST_SANDBOX_INSTALL_RUNTIME_PACKAGES:-1}"
DEPLOY=0

for arg in "$@"; do
  case "$arg" in
    --deploy) DEPLOY=1 ;;
    -h|--help)
      sed -n '1,14p' "$0"
      exit 0
      ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [ "${RUST_SANDBOX_RUNTIME_IMAGE:-}" = "" ] && [ -z "$(docker images -q "$RUNTIME_IMAGE" 2>/dev/null)" ] && [ -n "$(docker images -q rust:1-bookworm 2>/dev/null)" ]; then
  RUNTIME_IMAGE="rust:1-bookworm"
  INSTALL_RUNTIME_PACKAGES=0
  echo ">> debian:bookworm-slim is not available locally; using cached rust:1-bookworm runtime"
fi

echo ">> building $IMAGE from $ROOT/sandbox (runtime=$RUNTIME_IMAGE)"
docker build --pull=false \
  --build-arg "RUNTIME_IMAGE=$RUNTIME_IMAGE" \
  --build-arg "INSTALL_RUNTIME_PACKAGES=$INSTALL_RUNTIME_PACKAGES" \
  -t "$IMAGE" "$ROOT/sandbox"

if [ "$DEPLOY" = "1" ]; then
  OLD="$(docker ps -aq --filter "name=^/${CONTAINER}$")"
  if [ -n "$OLD" ]; then
    echo ">> removing current rust sandbox container $OLD"
    docker rm -f "$OLD" >/dev/null
  fi

  OLD_BY_PORT="$(docker ps -q --filter "publish=${PORT}")"
  if [ -n "$OLD_BY_PORT" ]; then
    echo ">> removing container(s) currently publishing :${PORT}: $OLD_BY_PORT"
    docker rm -f $OLD_BY_PORT >/dev/null
  fi

  echo ">> starting $CONTAINER on ${HOST}:${PORT}->5050"
  docker run -d --restart unless-stopped --privileged \
    --security-opt seccomp=unconfined \
    --security-opt apparmor=unconfined \
    -e BIND=0.0.0.0:5050 \
    -e FRONTEND_DIR=/app/frontend \
    -e SANDBOX_CLI=sandbox-cli \
    -e JOBS_ROOT=/tmp/sandbox-jobs \
    -e SANDBOX_FILE_ROOT=/tmp/sandbox-files \
    -p "${HOST}:${PORT}:5050" \
    --name "$CONTAINER" "$IMAGE" >/dev/null

  sleep 2
  echo ">> /api/version:"
  curl -fsS "http://${PROBE_HOST}:${PORT}/api/version"
  echo
fi

echo ">> done"
