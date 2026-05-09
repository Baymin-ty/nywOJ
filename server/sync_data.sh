#!/usr/bin/env bash
#
# sync_data.sh — pull test cases from the deploy server into this checkout.
#
# Usage:
#   ./sync_data.sh             # sync all problems
#   ./sync_data.sh <pid>       # sync only data/<pid>/
#
# Configuration is read from:
#   1. config.json's "SYNC" section (preferred; needs `jq` installed):
#      {
#        "SYNC": {
#          "remote":        "root@host.example",
#          "remoteDataDir": "/root/nywoj/server/data"
#        }
#      }
#   2. Environment variables NYWOJ_SYNC_REMOTE / NYWOJ_SYNC_REMOTE_DIR
#      (fallback when jq is missing or SYNC keys are absent)
#
# Local paths are derived from this script's location so the script works
# regardless of where the repo is checked out.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_BASE="$SCRIPT_DIR/data"
BACKUP_DIR="$SCRIPT_DIR/data_backup"
CONFIG_JSON="$SCRIPT_DIR/config.json"

read_config() {
  local key="$1"
  if [[ -f "$CONFIG_JSON" ]] && command -v jq >/dev/null 2>&1; then
    jq -r --arg key "$key" '.SYNC[$key] // empty' "$CONFIG_JSON" 2>/dev/null || true
  fi
}

REMOTE="${NYWOJ_SYNC_REMOTE:-$(read_config remote)}"
REMOTE_DIR="${NYWOJ_SYNC_REMOTE_DIR:-$(read_config remoteDataDir)}"

if [[ -z "$REMOTE" || -z "$REMOTE_DIR" ]]; then
  echo "sync_data.sh: missing remote config." >&2
  echo "  Set SYNC.remote / SYNC.remoteDataDir in config.json (needs jq)," >&2
  echo "  or export NYWOJ_SYNC_REMOTE and NYWOJ_SYNC_REMOTE_DIR." >&2
  exit 1
fi

PID="${1:-}"
if [[ -n "$PID" ]]; then
  SOURCE="$REMOTE:$REMOTE_DIR/$PID/"
  TARGET="$LOCAL_BASE/$PID/"
else
  SOURCE="$REMOTE:$REMOTE_DIR/"
  TARGET="$LOCAL_BASE/"
fi

mkdir -p "$TARGET" "$BACKUP_DIR"

rsync -avz --delete --backup --backup-dir="$BACKUP_DIR" "$SOURCE" "$TARGET"

echo -e "同步完成于 $(date) (源: $SOURCE)\n"
