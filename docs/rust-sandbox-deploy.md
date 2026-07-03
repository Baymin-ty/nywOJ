# Rust Sandbox 部署与启动

本文说明如何部署仓库内 `sandbox/` Rust sandbox。后端直接调用 nywOJ sandbox API，不再保留旧执行层协议。

## 目标拓扑

- Rust sandbox Docker 容器监听 `127.0.0.1:5050`
- Node 后端通过 `http://127.0.0.1:5050/api/run`、`/api/file/:id`、`/api/version` 访问 sandbox
- 在线 IDE 通过 `ws://127.0.0.1:5050/api/stream` 访问 sandbox stream
- sandbox 端口只绑定本机，不对公网开放

## 前置条件

- Linux 主机或 Linux 虚拟机
- Docker
- cgroup v2
- 后端 `server/config.json` 已存在
- 仓库代码已经包含 `sandbox/` 与 `deploy/rust-sandbox/build.sh`

Rust sandbox 使用 Linux namespace、cgroup、pivot_root、seccomp 等能力，容器启动时需要 `--privileged`。

## 构建

在仓库根目录执行：

```bash
cd /srv/nywOJ
deploy/rust-sandbox/build.sh
```

默认镜像名：

```text
nywoj-rust-sandbox:latest
```

可用环境变量覆盖：

```bash
RUST_SANDBOX_IMAGE=registry.example.com/nywoj-rust-sandbox:latest \
deploy/rust-sandbox/build.sh
```

弱网或离线机器如果已经缓存了 `rust:1-bookworm` 但没有 `debian:bookworm-slim`，脚本会自动用 `rust:1-bookworm` 作为 runtime 镜像。也可以手动指定：

```bash
RUST_SANDBOX_RUNTIME_IMAGE=rust:1-bookworm \
RUST_SANDBOX_INSTALL_RUNTIME_PACKAGES=0 \
deploy/rust-sandbox/build.sh
```

## 部署

```bash
cd /srv/nywOJ
deploy/rust-sandbox/build.sh --deploy
```

脚本会：

- 构建 Rust sandbox 镜像
- 删除同名旧 Rust sandbox 容器
- 删除正在占用目标端口的容器
- 启动 `nywoj-rust-sandbox`
- 探测 `/api/version`

默认绑定：

```text
127.0.0.1:5050 -> container:5050
```

自定义绑定：

```bash
RUST_SANDBOX_HOST=127.0.0.1 \
RUST_SANDBOX_PORT=5050 \
RUST_SANDBOX_CONTAINER=nywoj-rust-sandbox \
deploy/rust-sandbox/build.sh --deploy
```

## 后端配置

后端默认访问：

```text
http://127.0.0.1:5050
ws://127.0.0.1:5050/api/stream
```

如果 sandbox 不在默认地址，在 `server/config.json` 添加：

```json
{
  "SANDBOX": {
    "url": "http://127.0.0.1:5050",
    "streamUrl": "ws://127.0.0.1:5050/api/stream"
  }
}
```

也可以用环境变量覆盖：

```bash
export NYWOJ_SANDBOX_URL=http://127.0.0.1:5050
export NYWOJ_SANDBOX_STREAM_URL=ws://127.0.0.1:5050/api/stream
```

改完配置或环境变量后，需要重启 Node 后端。

## 升级脚本

`deploy/upgrade/cloud-upgrade.sh` 默认会构建并部署 Rust sandbox：

```bash
cd /srv/nywOJ
NYWOJ_BACKUP_DB=1 deploy/upgrade/cloud-upgrade.sh
```

只升级 sandbox 和重启服务：

```bash
deploy/upgrade/cloud-upgrade.sh --skip-db --skip-profile --skip-audit --skip-web
```

跳过 sandbox：

```bash
deploy/upgrade/cloud-upgrade.sh --skip-sandbox
```

## 健康检查

基础探测：

```bash
curl -fsS http://127.0.0.1:5050/api/version
```

期望看到：

- `name` 为 `nywOJ-rust-sandbox`
- `cachedOutputs: true`
- `pipes: true`
- `stream: true`
- `memoryAccounting` 为 cgroup/rusage 相关说明

运行 smoke：

```bash
SANDBOX_URL=http://127.0.0.1:5050 sandbox/scripts/spj-smoke.mjs
SANDBOX_URL=http://127.0.0.1:5050 sandbox/scripts/pipe-smoke.mjs
SANDBOX_URL=http://127.0.0.1:5050 sandbox/scripts/security-smoke.mjs
SANDBOX_URL=http://127.0.0.1:5050 sandbox/scripts/adversarial-smoke.mjs
SANDBOX_URL=http://127.0.0.1:5050 sandbox/scripts/malicious-corpus-smoke.mjs
SANDBOX_WS_URL=ws://127.0.0.1:5050/api/stream sandbox/scripts/stream-smoke.mjs
```

后端连通性探测：

```bash
cd /srv/nywOJ
NYWOJ_SANDBOX_URL=http://127.0.0.1:5050 \
node -e "const s=require('./server/api/judge/sandbox'); s.runOne({command:['/bin/true'],env:['PATH=/usr/bin:/bin'],stdio:[{content:''},{name:'stdout',max:1024},{name:'stderr',max:1024}],limits:{cpuMs:1000,wallMs:2000,memoryMB:64,processes:10},outputFiles:['stdout','stderr']}).then(r=>console.log(r.status)).catch(e=>{console.error(e);process.exit(1)})"
```

期望输出：

```text
Accepted
```

## 本地开发

本地不建议直接在 macOS 上运行 sandbox-core，因为它依赖 Linux syscall。用 Docker 启动开发服务：

```bash
cd /Users/ty/Desktop/nywOJ
docker run --rm --privileged --name nywoj-rust-sandbox-dev \
  -p 127.0.0.1:1146:1145 \
  -v "$PWD/sandbox:/src" \
  -w /src \
  -e FRONTEND_DIR=/src/frontend \
  -e SANDBOX_CLI=/src/target/debug/examples/cli \
  -e JOBS_ROOT=/tmp/sandbox-jobs \
  -e SANDBOX_FILE_ROOT=/tmp/sandbox-files \
  -e BIND=0.0.0.0:1145 \
  rust:1-bookworm \
  sh -lc 'cargo build -p sandbox-web && cargo build -p sandbox-core --example cli && exec target/debug/sandbox-web'
```

本地 smoke 把 `SANDBOX_URL` 改为 `http://127.0.0.1:1146`，把 `SANDBOX_WS_URL` 改为 `ws://127.0.0.1:1146/api/stream`。

## 常用运维命令

```bash
docker ps --filter name=nywoj-rust-sandbox
docker logs -f nywoj-rust-sandbox
docker restart nywoj-rust-sandbox
docker rm -f nywoj-rust-sandbox
```

## 排障

`/api/version` 访问失败：

- 检查容器是否运行：`docker ps --filter name=nywoj-rust-sandbox`
- 检查端口是否被占用：`ss -ltnp | grep 5050`
- 检查日志：`docker logs nywoj-rust-sandbox`

提交显示评测机不可用：

- 确认 Node 后端重启过
- 确认 `server/config.json` 或环境变量指向 Rust sandbox
- 用上面的后端连通性探测命令验证

在线 IDE 无法连接：

- 检查 `SANDBOX.streamUrl` / `NYWOJ_SANDBOX_STREAM_URL` 是否指向 `/api/stream`
- 检查反代是否支持 WebSocket Upgrade
- 先跑 `sandbox/scripts/stream-smoke.mjs`，再查 `/api/ide/stream`
