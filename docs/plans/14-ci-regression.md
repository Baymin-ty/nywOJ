# 方案 14：回归测试收敛进 CI

> 类型：夯实 · 规模：M · 前置：方案 15 · 公共约定见 [00-INDEX.md](00-INDEX.md)

## 背景

回归资产很好但散落各处：`server/auth/test.js`（RBAC）、比赛系统 47 项回归（M6 交付）、判题 e2e（真 worker + 活沙箱）、`server/scripts/aiAssistantE2E.js`（需 LLM key）。每次里程碑靠手跑。目标：统一入口 + 分层 + GitHub Actions。

## 分层原则

- **logic 层**（CI 可跑）：只依赖 MariaDB，不需要沙箱/LLM/SMTP。RBAC、policy 矩阵、赛制计分归约、封榜回放、standings 引擎、db/format 等。
- **e2e 层**（仅本地）：需要活 Rust sandbox（:5050）或 LLM key。判题六类题型、aiAssistant 全链路。

## 步骤

1. **盘点**：列出 `server/scripts/`、`server/auth/test.js` 及仓库内所有可执行测试脚本，逐个标注依赖（DB / sandbox / LLM / SMTP），产出清单写进 `docs/testing.md`（新建）。
2. **目录收敛**：测试统一挪到/链接到 `server/test/`，按 `logic/` 与 `e2e/` 分子目录。写一个极简 runner（`server/test/run.js`：顺序执行目录下脚本，非零即失败，汇总输出），不引测试框架，保持零新依赖。若现有脚本内部有「需要真沙箱」的子步骤，拆开或加 `SKIP_SANDBOX=1` 分支。
3. **npm scripts**（server/package.json）：
   - `npm run test:logic` → `node test/run.js logic`
   - `npm run test:e2e` → `node test/run.js e2e`（前置检查 :5050 可达，不可达则明确报错）
   - `npm test` → 先 logic，再（若沙箱可达）e2e
4. **迁移脚本统一**：新建 `server/scripts/apply_migrations.sh`：按顺序应用 `server/auth/migration.sql` + `server/db/add_*.sql`（全部已是幂等写法），CI 与新环境部署共用；`docs/cloud-upgrade.md` 引用它替代手工罗列。
5. **GitHub Actions**：`.github/workflows/ci.yml`，push/PR 到 next 触发：
   - job `server-logic`：`mariadb:10.11` service container；node 20；`cp config.example.json config.json` 后用 env/jq 注入 CI DB 连接；跑 apply_migrations.sh；`npm ci && npm run test:logic`。注意 comparer 若 logic 层用到需 `(cd comparer && make)`。
   - job `web-build`：`cd web && npm ci && npm run build`（构建即测试）。
   - e2e 层不进 CI，在 workflow 注释与 docs/testing.md 写明本地跑法。
6. **文档**：README「启动方式」加测试一节；docs/testing.md 收录分层说明、各脚本用途、本地 e2e 前置（沙箱 Docker 起法引用 docs/rust-sandbox-deploy.md）。

## 验收标准

- [ ] 本地 `npm run test:logic` 一条命令全绿（干净 DB 从迁移开始）
- [ ] 本地 `npm run test:e2e` 在沙箱运行时全绿，沙箱未起时给出明确报错而非误报失败
- [ ] GitHub Actions 两个 job 均绿（推一个 commit 验证）
- [ ] 比赛 47 项回归包含在 logic 层且通过
- [ ] docs/testing.md 与 README 更新

## 注意

- config.json 含敏感信息已 gitignore，CI 一律从 config.example.json 生成，别提交任何真实凭据。
- 47 项回归若当前依赖真评测（提交要判题出分），把「造提交」步骤改为直接 UPDATE submission 写入判决与分数（榜单引擎只读 submission 表，不关心分数怎么来的），使其降级为 logic 层；保留原版作为 e2e 层的全链路变体。
