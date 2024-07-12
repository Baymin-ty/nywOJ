#!/bin/bash
pid=""

if [ "$1" != "" ]; then
  pid=$1"/"
fi

# 设置变量
SOURCE_SERVER="root@110.42.109.94"
SOURCE_DIR="/root/nywoj/server/data/"$pid
LOCAL_DIR="/Users/ty/Desktop/nywOJ/server/data/"$pid
BACKUP_DIR="/Users/ty/Desktop/nywOJ/server/data_backup"

# 确保备份目录存在
mkdir -p "$BACKUP_DIR"

# 执行rsync
rsync -avz --delete --backup --backup-dir="$BACKUP_DIR" "$SOURCE_SERVER:$SOURCE_DIR" "$LOCAL_DIR"

# 输出同步完成信息
echo -e "同步完成于 $(date)\n\n"
