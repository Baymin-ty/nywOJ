#!/usr/bin/env bash
# =============================================================================
# 按顺序把库表结构应用到 config.json 指向的数据库：
#   1) db/schema.sql        基础表（幂等，IF NOT EXISTS）
#   2) auth/migration.sql   RBAC 权限表 + 一次性回填
#   3) db/add_*.sql         增量迁移（幂等，schema 已含时为 no-op）
#
# 全新环境建库、CI 建库、以及既有库补迁移都用它。所有脚本幂等，可重复执行。
# 连接信息取自 server/config.json（CI 里由 config.example.json 生成后注入）。
#
# 用法：
#   cd server && bash scripts/apply_migrations.sh
#   DB_NAME=other bash scripts/apply_migrations.sh      # 覆盖库名
# =============================================================================
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SERVER_DIR"

if [ ! -f config.json ]; then
  echo "config.json 不存在；先 cp config.example.json config.json 并填写连接信息" >&2
  exit 1
fi

# 从 config.json 读连接信息（允许 DB_* 环境变量覆盖）
read_cfg() { node -e "process.stdout.write(String((require('./config.json').DB||{})['$1']||''))"; }
DB_HOST="${DB_HOST:-$(read_cfg host)}"
DB_PORT="${DB_PORT:-$(read_cfg port)}"
DB_USER="${DB_USER:-$(read_cfg username)}"
DB_PASS="${DB_PASS:-$(read_cfg password)}"
DB_NAME="${DB_NAME:-$(read_cfg databasename)}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"

if [ -z "$DB_NAME" ]; then echo "库名为空（config.DB.databasename）" >&2; exit 1; fi

# 优先 mysql，回退 mariadb 客户端
CLIENT="mysql"
command -v mysql >/dev/null 2>&1 || CLIENT="mariadb"

run_sql() {
  local file="$1"
  echo "  -> $file"
  MYSQL_PWD="$DB_PASS" "$CLIENT" -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" "$DB_NAME" < "$file"
}

echo "应用迁移到 $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME （客户端 $CLIENT）"

# 确保库存在（幂等）
MYSQL_PWD="$DB_PASS" "$CLIENT" -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" \
  -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;"

run_sql db/schema.sql
run_sql auth/migration.sql

# 增量迁移按文件名排序应用（新增 add_*.sql 会自动纳入）
for f in $(ls db/add_*.sql | sort); do
  run_sql "$f"
done

echo "迁移完成。"
