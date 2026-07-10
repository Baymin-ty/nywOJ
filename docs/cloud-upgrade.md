# 云端升级方案：250fa62 -> 当前版本

这份文档面向已经在线运行的旧版 nywOJ。统计口径是从
`250fa620`（2026-05-24 13:05:38 +0800）之后到当前工作区的代码状态，
包含已提交的 `01446692`、比赛系统 M1-M6，以及当前未提交的云端部署补丁。

目标不是只升级单个功能，而是把当前主站需要的数据库、Node 后端、前端静态资源、
Rust sandbox、Nginx 长连接反代和远程评测机策略一次梳理清楚。

## 1. 250fa62 之后的主要修改

### 账户、权限与管理后台

- 旧三档 `gid` 身份模型迁移为 RBAC：`permissions`、`roles`、
  `role_permissions`、`user_roles`、`user_permissions`。
- 启动时 `auth/sync.js` 会同步权限目录、内置角色、权限重命名，并把旧
  `userInfo.gid` 回填为角色。默认会删除 `userInfo.gid`；如需灰度回滚窗口，
  启动或升级时设置 `DISABLE_DROP_GID=1`。
- 新增用户会话管理、邮箱登录/找回、用户资料、审计日志、用户组与组权限。
- 后台合并为 `/system/*` 管理入口，覆盖权限中心、评测监控、Rating 工具、
  首页配置、题目标签和数据迁移工具。

### 题目、数据与 AI 出题

- 题目接口拆分到 `server/api/problem/*`。
- 新增 `problem.judgeProfile`，用声明式评测档案替代旧 `type` 分支；
  存量题可按旧类型幂等回填。
- 新增 `problem.solVisible` 控制题解可见性，新增题面样例、题目标签目录、
  测试数据体检、资产文件管理、题目归档导入/导出。
- LLM 出题助手可以生成题面、STD、题解、静态数据、generator、checker、
  interactor、grader 和 `judgeProfile`，并支持流式生成与分步保存。

### 评测、沙箱与在线 IDE

- 评测系统重写为统一 worker：语言注册表、并发队列、SPJ checker 缓存、
  多文件提交、提交答案、交互/通信/函数题资产运行都走同一套流水线。
- 仓库内新增 Rust sandbox，默认以 Docker 容器绑定 `127.0.0.1:5050`，
  提供 `/api/run`、`/api/file`、`/api/stream` 和 pipes 能力。
- 在线 IDE 使用 `/api/ide/stream` WebSocket 和 sandbox stream 通信。
- 提交进度提供 SSE：`/api/judge/streamSubmission`、
  `/api/contest/streamSubmission`。
- 新增评测机注册、心跳和远程任务分发（HTTP `/api/judge/receiveTask`）。

### 比赛系统 M1-M6

- 服务端拆分为 `formats`、`policy`、`standings`、`teams`、`hacks`、
  `health`、`rating` 等模块。
- 比赛赛制变为 `contest.format` + `contest.config`：`oi`、`ioi`、`acm`、
  `cf`、`homework` 都是 preset，管理者可覆盖封榜、真实分数、hack、组队、
  迟交等独立开关。
- 榜单改为事件回放：支持任意时刻 `getRankAt`、选手时间线、封榜掩码、
  一血、赛后官方榜固化。
- 新增 ACM 罚时、CF pretest/systest/hack、全赛制组队参赛、作业入口、
  迟交扣分、完成度统计。
- 新增 Rating 结算、预览、重建、清理和健康检查；组队和作业默认不计 Rating。
- 新增比赛体检，覆盖题目数据、judgeProfile 资产、CF pretest/hack、
  组队、作业、封榜和支持语言等风险项。

### 前端与文档

- Vue 路由补齐 `/p`、`/s`、`/d`、`/u`、`/homework`、`/system/*` 等入口，
  旧路径多数会重定向到新页面。
- 新增在线 IDE、题目 AI 助手、数据生成面板、judgeProfile 设计器、Rating 工具、
  评测监控、迁移工具、首页设置、题目标签管理、用户榜/用户主页增强。
- 新增或更新 `contest-system.md`、`judge-pipeline.md`、`data-config-guide.md`、
  `llm-usage-guide.md` 和 `rust-sandbox-*`。

## 2. 云端部署拓扑

主站建议结构：

```text
Nginx :80/:443
  |-- /              -> /srv/nywOJ/web/dist
  |-- /api/*         -> Node backend 127.0.0.1:1234
  |-- /api/ide/stream -> WebSocket upgrade
  |-- SSE endpoints  -> proxy_buffering off

Node backend 127.0.0.1:1234
  |-- MySQL / MariaDB
  |-- server/data/<pid>
  |-- Rust sandbox http://127.0.0.1:5050

Rust sandbox Docker
  |-- deploy/rust-sandbox/build.sh --deploy
```

远程评测机也要运行同版本代码和 Rust sandbox。确认每台远程评测机都已经只在
sandbox 内执行用户代码后，再在主站开启：

```json
"JUDGE": {
  "ALLOW_REMOTE_SANDBOX_CLIENTS": true
}
```

## 3. 主站一键升级

在云端先更新代码，并确认 `server/config.json` 仍是生产库配置：

```bash
cd /srv/nywOJ
git pull
cp -n server/config.example.json server/config.json
```

建议先设置备份、重启和公网探测变量：

```bash
export NYWOJ_BACKUP_DB=1
export NYWOJ_BACKUP_DIR=/var/backups/nywoj
export NYWOJ_BACKEND_RESTART_CMD='pm2 reload nywoj-server --update-env'
export NYWOJ_PROXY_RELOAD_CMD='nginx -t && systemctl reload nginx'
export NYWOJ_PUBLIC_URL='https://oj.example.com'
```

如果你希望保留旧 `userInfo.gid` 一段时间，额外设置：

```bash
export DISABLE_DROP_GID=1
```

执行升级：

```bash
cd /srv/nywOJ
deploy/upgrade/cloud-upgrade.sh
```

脚本可重复执行，主站默认会做这些事：

1. 安装后端依赖并构建 `server/comparer/comparer`
2. 备份数据库（设置 `NYWOJ_BACKUP_DB=1` 或传 `--backup-db` 时）
3. 执行幂等 SQL：`add_judgeProfile.sql`、`add_solVisible.sql`、
   `add_contestV2.sql`、`add_contestRating.sql`
4. 执行运行时 schema 同步：权限目录、用户组、contest V2、Rating 存储
5. 回填旧题 `judgeProfile`，并做 profile 资产体检
6. 构建并替换 Rust sandbox 容器
7. 安装前端依赖并构建 `web/dist`
8. 重启后端并 reload Nginx
9. 探测 sandbox、后端 REST 和 `/api/ide/stream`

常用开关：

```bash
# 只看旧题会回填哪些 profile，不写库
cd server && node db/migrate_profiles.js

# 主站已经构建好前端，只补 DB + sandbox + 重启
deploy/upgrade/cloud-upgrade.sh --skip-web

# 只补数据库和前端，不重启服务
deploy/upgrade/cloud-upgrade.sh --skip-sandbox --skip-restart

# 跳过运行时权限/contest/rating schema 同步
deploy/upgrade/cloud-upgrade.sh --skip-schema-sync
```

## 4. 远程评测机升级

远程评测机一般不需要改主库 schema，也不需要构建前端：

```bash
cd /srv/nywOJ
git pull
deploy/upgrade/cloud-upgrade.sh --skip-db --skip-profile --skip-audit --skip-web
```

然后重启远程评测机自己的 Node 服务。确认：

- `server/config.json` 中 `JUDGE.ISSERVER=false`
- `JUDGE.CLIENT_KEY` 与主站后台生成的 Key 一致
- `SANDBOX.url` 指向本机 sandbox，例如 `http://127.0.0.1:5050`
- 测试数据通过 `server/sync_data.sh` 能从主站同步

## 5. Nginx / 反代要求

完整示例见 `deploy/upgrade/nginx-nywoj.conf`。至少要满足：

- `/api/ide/stream` 传递 `Upgrade` 和 `Connection`
- SSE 端点关闭 `proxy_buffering`
- `client_max_body_size` 不小于 `server/config.json` 的 `HTTP.bodyLimit`
- 前端根目录指向最新 `web/dist`

宝塔等面板部署时，需要确认 WebSocket 代理已开启，且不要让
`/api/ide/stream` 或 SSE 端点落到前端静态目录。

## 6. 升级后验证

本机探测：

```bash
curl -fsS http://127.0.0.1:5050/api/version
curl -fsS -X POST -H 'Content-Type: application/json' -d '{}' \
  http://127.0.0.1:1234/api/common/getAnnouncementList
curl -i -N \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  http://127.0.0.1:1234/api/ide/stream
```

公网探测把 host 换成域名即可。`/api/ide/stream` 未带登录 cookie 时返回
`401` 属于正常，说明请求已经到达后端；如果得到 `200`、`301`、`404`、`502`，
优先检查反代路径、HTTPS 跳转、Upgrade 头和后端服务状态。

浏览器侧至少验证：

- 登录、退出、权限中心可以打开
- `/ide` 能运行 C++ 或 Python 模板，并能看到实时输出
- 题目数据页体检通过，能保存 judgeProfile 和资产
- 非比赛提交能看到 SSE 实时进度
- 创建一场 IOI/ACM/作业测试赛，提交后榜单能更新
- 后台 Rating 工具能打开，健康检查无错误

## 7. 回滚与注意事项

- 数据库升级前务必备份。脚本的 SQL 大多幂等，但 RBAC 默认删除
  `userInfo.gid`；需要灰度时设置 `DISABLE_DROP_GID=1`。
- Rust sandbox 容器默认只绑定 `127.0.0.1:5050`。不要把 sandbox 直接暴露公网。
- 远程评测机未完成 sandbox 升级前，不要开启
  `JUDGE.ALLOW_REMOTE_SANDBOX_CLIENTS`。
- 如果 `node db/audit_profiles.js --bad` 报缺少 checker、interactor、grader
  等资产，先修题目数据再重启 worker。
- 如果 `contestRating` 历史表存在重复 `(cid, uid)` 或空键，脚本会同步表结构，
  但唯一约束可能无法补上；用后台 Rating 工具的健康检查/清理功能处理后再重建。
