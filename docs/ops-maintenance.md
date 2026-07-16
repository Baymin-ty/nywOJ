# 云端运维手册（niyiwei.com）

2026-07-16 整理。记录生产环境的部署结构、三大组件的日常维护方式、升级流程与故障排查。
一次性的「旧版 → 当前版」升级方案已完成使命并删除，本文是取代它的长期维护文档。

## 1. 部署拓扑

| 组件 | 位置 / 形态 | 端口 |
|------|------------|------|
| 代码目录 | `/root/nywoj`（git archive 解包，非 git 仓库） | — |
| Node 后端 | systemd 服务 `nywoj.service` | 127.0.0.1:1234 |
| 前端静态 | nginx 直接服务 `/home/www/dist` | 80 / 443 |
| Rust 评测沙箱 | Docker 容器 `nywoj-rust-sandbox` | 127.0.0.1:5050 |
| 数据库 | MariaDB（systemd `mariadb.service`），库名 `ty` | 127.0.0.1:3306 |
| 反向代理 | nginx，配置在 `/etc/nginx/nginx.conf` | 80 / 443 |

域名：`niyiwei.com`（主站）；`ty.szsyzx.cn`、`www.niyiwei.com` 302 跳转到主站。
测试数据在 `/root/nywoj/server/data/<pid>/`（约 9.5G），生产配置在 `/root/nywoj/server/config.json`。

三个组件都已配置为**开机自启 + 崩溃自动拉起**，正常情况下无需人工干预。

## 2. 后端（Node）

systemd 单元：`/etc/systemd/system/nywoj.service`
（`node app.js`，工作目录 `/root/nywoj/server`，`Restart=always`，崩溃 3 秒后自动重启）

```bash
systemctl status nywoj              # 状态
systemctl restart nywoj             # 改代码 / 改 config.json 后重启生效
journalctl -u nywoj -f              # systemd 日志（实时）
tail -f /root/nywoj/server/app.log  # 业务日志
```

只更新后端代码时：替换 `/root/nywoj/server` 下对应文件 → `systemctl restart nywoj`。
如果 `package.json` 变了，先在 `/root/nywoj/server` 执行 `npm ci --omit=dev` 再重启。

> 注意：仓库 `package-lock.json` 里混有 `mirrors.cloud.tencent.com` 的 resolved URL，
> 新版 npm 会拒绝跨源拉取。服务器上已用 sed 统一改写为 `registry.npmmirror.com`；
> 若重新解包代码后安装失败，重跑：
> `sed -i 's#https://mirrors.cloud.tencent.com/npm/#https://registry.npmmirror.com/#g; s#https://registry.npmjs.org/#https://registry.npmmirror.com/#g' package-lock.json`

## 3. 前端（nginx + 静态文件）

前端没有常驻进程，只是 `/home/www/dist` 下的静态文件。更新流程（本地 Mac 上构建）：

```bash
cd ~/Desktop/nywOJ/web && npm run build
tar czf dist.tar.gz dist
scp -P 2222 dist.tar.gz root@114.28.145.95:/root/
```

服务器上替换（保留旧版可回滚）：

```bash
cd /home/www
mv dist dist-old-$(date +%Y%m%d) && tar xzf /root/dist.tar.gz
```

nginx 配置要点（已配置好，改动前先备份）：

- `/api/ide/stream` 单独 location，带 `Upgrade`/`Connection` 头（WebSocket，在线 IDE 依赖）
- SSE 端点（`/api/judge/streamSubmission`、`/api/contest/streamSubmission`、
  `/api/problem/ai/generationStream`）`proxy_buffering off; gzip off`
- `client_max_body_size` 不小于后端 `HTTP.bodyLimit`（当前 64m）
- 参考模板：`deploy/upgrade/nginx-nywoj.conf`

改完配置：`nginx -t && systemctl reload nginx`。历史备份：`/etc/nginx/nginx.conf.bak-20260716`。

## 4. 评测沙箱（Docker）

容器 `nywoj-rust-sandbox`，`--restart unless-stopped`（随 docker 开机自启、崩溃自动拉起）。

```bash
docker ps --filter name=nywoj-rust-sandbox   # 状态
docker restart nywoj-rust-sandbox            # 重启
docker logs -f nywoj-rust-sandbox            # 日志
curl http://127.0.0.1:5050/api/version       # 健康检查
```

仅当 `sandbox/` 代码更新时需要重建镜像（服务器在国内，务必带镜像源开关，约 7 分钟）：

```bash
cd /root/nywoj && RUST_SANDBOX_CN_MIRRORS=1 deploy/rust-sandbox/build.sh --deploy
```

`RUST_SANDBOX_CN_MIRRORS=1` 会让 cargo 走 rsproxy.cn、apt 走 mirrors.aliyun.com；
不带这个开关直连 crates.io/deb.debian.org 可能卡 40 分钟以上。
sandbox 详细部署与参数见 [rust-sandbox-deploy.md](rust-sandbox-deploy.md)，
API 协议见 [rust-sandbox-migration.md](rust-sandbox-migration.md)。

## 5. 数据库

- 直接 `mysql` 即可进（root 本机 socket 认证），库名 `ty`
- 手动备份：`mysqldump --default-character-set=utf8mb4 ty > /root/nywoj-backups/ty-$(date +%Y%m%d).sql`
- 新迁移一律写成幂等 SQL 放 `server/db/add_<name>.sql`（参照 `add_judgeProfile.sql`），
  并加进 `deploy/upgrade/cloud-upgrade.sh` 的迁移清单

## 6. 整体升级流程（版本更新）

本地：

```bash
cd ~/Desktop/nywOJ
(cd web && npm run build) && tar czf dist.tar.gz -C web dist
git archive --format=tar.gz -o code.tar.gz next -- . ':(exclude)Archive.zip'
scp -P 2222 code.tar.gz dist.tar.gz root@114.28.145.95:/root/
```

服务器（保留运行时状态，换掉代码）：

```bash
mkdir /root/nywoj-new && tar xzf /root/code.tar.gz -C /root/nywoj-new
cp  /root/nywoj/server/config.json          /root/nywoj-new/server/
cp -a /root/nywoj/server/data               /root/nywoj-new/server/
cp -a /root/nywoj/server/answerSubmissions  /root/nywoj-new/server/
mv /root/nywoj /root/nywoj-old-$(date +%Y%m%d) && mv /root/nywoj-new /root/nywoj

cd /root/nywoj/server && npm ci --omit=dev   # 失败见 §2 的 lockfile 注意事项
cd /root/nywoj
NYWOJ_BACKEND_SERVICE=nywoj.service NYWOJ_BACKUP_DB=1 \
RUST_SANDBOX_CN_MIRRORS=1 NYWOJ_PUBLIC_URL=https://niyiwei.com \
  deploy/upgrade/cloud-upgrade.sh --skip-deps --skip-web
```

脚本会自动：备份数据库 → 跑幂等迁移 → 同步运行时 schema → 回填/体检 judgeProfile →
重建沙箱 → 重启后端 → 健康探测。最后按 §3 替换前端 dist。

## 7. 健康检查一条龙

怀疑站点有问题先跑这个（服务器上）：

```bash
systemctl is-active nywoj nginx mariadb docker
curl -fsS http://127.0.0.1:5050/api/version >/dev/null && echo "sandbox OK"
curl -fsS -X POST -H 'Content-Type: application/json' -d '{}' \
  http://127.0.0.1:1234/api/common/getAnnouncementList >/dev/null && echo "api OK"
curl -s --http1.1 -o /dev/null -w "ws: %{http_code}\n" \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  https://niyiwei.com/api/ide/stream        # 期望 401（未登录）；404/502 说明反代有问题
```

> WS 探测必须加 `--http1.1`：HTTP/2 下 Upgrade 头会被丢弃，探测会假阴性返回 404，
> 但真实浏览器不受影响。

浏览器侧抽查：登录、`/ide` 跑一段 C++ 且能交互、随便交一题能看到实时进度和判定、
后台「评测监控」里 Sandbox 显示正常。

## 8. 回滚

- 代码：旧版本目录还在（`/root/nywoj-old-<日期>`），`mv` 换回来 + `systemctl restart nywoj`
- 前端：`/home/www/dist-old-<日期>` 同理
- 数据库：`mysql ty < /root/nywoj-backups/<备份>.sql`（迁移 SQL 全部幂等，一般不需要回滚库）
- nginx：`cp /etc/nginx/nginx.conf.bak-<日期> /etc/nginx/nginx.conf && nginx -t && systemctl reload nginx`

确认新版稳定后，旧目录和过期备份可删掉腾空间。

## 9. 远程评测机（如果以后加）

远程评测机跑同版本代码 + 自己的 sandbox，不需要建库/建前端：

```bash
cd /root/nywoj
deploy/upgrade/cloud-upgrade.sh --skip-db --skip-profile --skip-audit --skip-web
```

确认它的 `config.json`：`JUDGE.ISSERVER=false`、`JUDGE.CLIENT_KEY` 与主站后台一致、
`SANDBOX.url` 指向本机 sandbox；测试数据用 `server/sync_data.sh` 从主站同步。
所有远程机都确认只在 sandbox 内执行用户代码后，主站才能开
`JUDGE.ALLOW_REMOTE_SANDBOX_CLIENTS=true`。

## 10. 历史坑备忘

- **测试数据丢失**（2026-07 已修复）：一次手工部署把 `server/data` 只留了 11 题，
  完整数据在旧副本 `server_/data` 里找回（含 9 道 SPJ 题的 `checker.cpp`）。
  以后升级永远用 §6 的流程整目录 `cp -a`，不要手挑文件。
- **Referer 白名单**：`server/app.js` 的 `whiteList` 必须包含所有对外域名
  （含裸域 `https://niyiwei.com`），漏了会导致浏览器全部 API 403 而 curl 正常。
- **npm lockfile 混源**：见 §2。
- **国内构建慢**：sandbox 构建见 §4 的 `RUST_SANDBOX_CN_MIRRORS`；docker 镜像源已在
  `/etc/docker/daemon.json` 配置 1ms.run / daocloud。
