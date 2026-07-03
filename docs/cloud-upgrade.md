# 云端升级最短路径：在线 IDE + judgeProfile

这份方案面向已经在线运行的旧版 nywOJ。目标是把当前 repo 的新增能力一次串起来：

- 数据库新增 `problem.judgeProfile`、`submissionFile`、`problem.solVisible`
- 存量题按旧 `type` 幂等回填 judgeProfile，并做资产体检
- Rust sandbox 接管 5050，并提供 `/api/run`、`/api/file`、`/api/stream`、`pipes` 原生接口
- 前端重新构建，后端重启，Nginx/反代支持 WebSocket

## 1. 上线前准备

在云端先完成代码更新，并确认 `server/config.json` 仍是生产库配置：

```bash
cd /srv/nywOJ
git pull
cp -n server/config.example.json server/config.json
```

建议让升级脚本先按 `server/config.json` 自动备份数据库：

```bash
export NYWOJ_BACKUP_DB=1
export NYWOJ_BACKUP_DIR=/var/backups/nywoj
```

如果后端不是默认进程名，需要先告诉脚本如何重启。二选一即可：

```bash
export NYWOJ_BACKEND_SERVICE=nywoj.service
# 或
export NYWOJ_BACKEND_RESTART_CMD='pm2 reload nywoj-server --update-env'
```

建议同时配置反代 reload 和公网探测地址：

```bash
export NYWOJ_PROXY_RELOAD_CMD='nginx -t && systemctl reload nginx'
export NYWOJ_PUBLIC_URL='https://oj.example.com'
```

## 2. 一条命令升级主站

```bash
cd /srv/nywOJ
NYWOJ_BACKUP_DB=1 deploy/upgrade/cloud-upgrade.sh
```

脚本可重复执行。它会按顺序做这些事：

1. `npm ci --omit=dev` 安装后端依赖，构建 `server/comparer/comparer`
2. 通过 `mysql` CLI 执行 `server/db/add_judgeProfile.sql` 和 `server/db/add_solVisible.sql`
3. 执行 `node db/migrate_profiles.js --apply`，只回填 `judgeProfile IS NULL` 的旧题
4. 执行 `node db/audit_profiles.js --bad`，发现缺失 `checker.cpp`/grader/interactor 等资产会中止
5. 执行 `deploy/rust-sandbox/build.sh --deploy`，构建并启动 `nywoj-rust-sandbox`
6. `npm ci && npm run build` 生成 `web/dist`
7. 重启后端服务并 reload 反代
8. 探测 Rust sandbox `/api/version`、后端 REST、`/api/ide/stream` WebSocket 握手

旧题回填不会覆盖已经手工保存过的 `judgeProfile`。新增题从 `createProblem` 开始会自带 traditional profile。

常用开关：

```bash
# 只想先看旧题会回填哪些 profile，不写库
cd server && node db/migrate_profiles.js

# 主站已经构建好前端，只补 DB + sandbox + 重启
deploy/upgrade/cloud-upgrade.sh --skip-web

# 只升级远程评测机
deploy/upgrade/cloud-upgrade.sh --skip-db --skip-profile --skip-audit --skip-web
```

## 3. Nginx / 反代必须支持 WebSocket

前端在线 IDE 会连接：

```text
wss://你的域名/api/ide/stream
```

反代必须把 `Upgrade` 和 `Connection` 头传给 Node 后端 `127.0.0.1:1234`。可参考：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

location /api/ide/stream {
    proxy_pass http://127.0.0.1:1234;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 130s;
    proxy_send_timeout 130s;
    proxy_buffering off;
}
```

完整示例在 `deploy/upgrade/nginx-nywoj.conf`。宝塔等面板需要确认已开启 WebSocket 代理，且不要把 `/api/ide/stream` 落到前端静态目录。

## 4. 需要重启或重载的服务

必须处理：

- Rust sandbox Docker 容器：脚本会重建并替换为 `nywoj-rust-sandbox`，默认只绑定 `127.0.0.1:5050`
- Node 后端：必须重启，因为 `app.js` 新挂了 WebSocket upgrade，启动时也会同步权限目录
- Nginx/反代：配置 WebSocket 后必须 reload
- 前端静态资源：必须重新构建并让站点根目录指向新的 `web/dist`

如果有独立远程评测机，也要在每台评测机拉代码并升级 sandbox/后端 worker；远程评测机通常不需要改主库和构建前端。主站默认不会向远程评测机分发提交，确认每台远程评测机都已经接入 Rust sandbox 后，再在主站 `JUDGE.ALLOW_REMOTE_SANDBOX_CLIENTS=true`：

```bash
cd /srv/nywOJ
deploy/upgrade/cloud-upgrade.sh --skip-db --skip-profile --skip-audit --skip-web
```

## 5. 验证

升级成功后至少验证：

```bash
curl -fsS http://127.0.0.1:5050/api/version
curl -fsS -X POST -H 'Content-Type: application/json' -d '{}' \
  http://127.0.0.1:1234/api/common/getAnnouncementList
curl -i -N \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  https://oj.example.com/api/ide/stream
```

最后一个请求未带登录 cookie，正常应返回 `401 Unauthorized`；这表示 WebSocket upgrade 已经到达后端。若返回 `200`、`301`、`404`、`502`，优先查反代路径、HTTPS 跳转和 Upgrade 头。

再用浏览器登录后打开 `/ide`，运行 C++ 或 Python 模板，确认能看到实时终端输出。
