# 测试与回归 / Testing

回归测试分两层，入口在 `server/test/run.js`（清单 `server/test/manifest.js`）：

| 层 | 依赖 | 何时跑 | 命令 |
|----|------|--------|------|
| **logic** | 仅 MySQL/MariaDB | CI + 本地 | `cd server && npm run test:logic` |
| **e2e** | 活 Rust sandbox(:5050) / LLM key | 仅本地 | `cd server && npm run test:e2e` |
| 两层 | 上述之和（沙箱不可用时 e2e 自动跳过） | 本地 | `cd server && npm test` |

runner 按清单顺序 fork 执行每个脚本，任一非零退出即整体失败。e2e 项标了 `needs`（sandbox / llm），前置不满足时打印 `[跳过]` 而非误报失败。

## logic 层脚本

| 脚本 | 覆盖 |
|------|------|
| `auth/test.js` | RBAC 权限 / 角色 / 组 / 题解绑定 / 比赛授权（208 断言） |
| `auth/test_admin.js` | 管理员操作 / 审计 / 用户改名封禁（115 断言） |
| `auth/http_access_smoke.js` | HTTP 路由鉴权冒烟（真实 server 子进程，36 断言） |
| `test/logic/contest_standings.test.js` | 榜单事件回放引擎五赛制计分 / 封榜掩码 / 组队聚合（23 断言） |

## e2e 层脚本

| 脚本 | 依赖 | 覆盖 |
|------|------|------|
| `test/e2e/judge_types.js` | sandbox | 编译 / 运行 / 比对（传统 AC·WA·RE） |
| `scripts/aiAssistantE2E.js` | LLM key | 出题助手全链路（传参赛制，见 `--list`） |

本地跑 e2e 前，先起 Rust sandbox（见 [rust-sandbox-deploy.md](rust-sandbox-deploy.md)），确认 `curl http://127.0.0.1:5050/api/version` 有响应。

## 全新库 / CI 建库

所有库表结构由幂等 SQL 组成，`scripts/apply_migrations.sh` 按序应用：

```
db/schema.sql        全部基础表（schema-only，IF NOT EXISTS）
auth/migration.sql   RBAC 权限表 + 目录种子
db/add_*.sql         增量迁移（幂等，schema 已含时 no-op）
```

CI 建库还需一步种子（`scripts/ci_seed.js`）：

- **占位 uid=1**：uid=1 恒为 root。空库若不占位，测试自种的第一个用户会撞成 uid=1 → 拥有全部权限 → 破坏权限隔离断言。
- **languages 基础行**：判题 / 提交路径引用。

本地 dev 库通常已有数据，`ci_seed.js` 幂等可安全重跑。

重新生成 schema.sql（升级基础表后）：

```bash
cd server
mysqldump --no-data --skip-comments --no-tablespaces --compact <DB> \
  | sed -E 's/CREATE TABLE `/CREATE TABLE IF NOT EXISTS `/; s/ AUTO_INCREMENT=[0-9]+//' \
  > /tmp/schema.body.sql
# 手动把 3 个 collation 归一到 utf8mb4_general_ci，套上 FOREIGN_KEY_CHECKS=0/1，加文件头
```

## GitHub Actions

`.github/workflows/ci.yml`，push / PR 到 `next` 触发：

- **server-logic**：`mariadb:10.11` service container → 生成 CI 配置 → 迁移 → 种子 → 构建 comparer → `npm run test:logic`。
- **web-build**：`cd web && npm ci && npm run build`（构建即测试）。

e2e 层不进 CI（需活沙箱 / LLM key）。
