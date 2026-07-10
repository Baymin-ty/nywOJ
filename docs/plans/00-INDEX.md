# nywOJ 下一阶段开发方案总索引

2026-07-10 拟定。16 个 idea 全部确认需要，其中 2 个经代码核实调整了范围：

- **自测运行（Custom Invocation）已上线**（`server/api/judge/customRun.js` + problemView 自测面板），只缺接口限流 → 并入 [11-security-hardening.md](11-security-hardening.md)。
- **Legacy 判题分支已在当前 staged 清理批中删除**（worker.js 已无 legacy 路径）→ 方案改为验收清单 [15-legacy-retirement-acceptance.md](15-legacy-retirement-acceptance.md)。

## 方案清单

| # | 方案 | 类型 | 规模 | 前置依赖 |
|---|------|------|------|---------|
| [15](15-legacy-retirement-acceptance.md) | Legacy 判题退役验收 + 提交清理批 | 夯实 | S | 无（**最先做**） |
| [14](14-ci-regression.md) | 回归测试收敛进 CI | 夯实 | M | 15 |
| [13](13-standings-cache.md) | 榜单引擎增量缓存 + 索引体检 | 优化 | M | 15 |
| [01](01-notifications.md) | 站内通知系统 | 新功能·地基 | M | 15 |
| [11](11-security-hardening.md) | 安全加固（限流/登录退避，含 customRun） | 夯实 | M | 15 |
| [03](03-clarifications.md) | 赛内提问 Clarification | 新功能 | M | 01 |
| [02](02-virtual-participation.md) | 虚拟参赛 | 新功能 | L | 13（同文件改动，避免冲突） |
| [04](04-resolver.md) | 滚榜（ICPC 揭榜动画） | 新功能 | M | 13 |
| [05](05-plagiarism.md) | 代码查重（算法层 + LLM 判读/码风一致性） | 新功能 | L | 无 |
| [06](06-problem-lists.md) | 题单 / 训练计划 | 新功能 | M | 01（可选接线） |
| [07](07-practice-stats.md) | 练习统计（热力图/分布/错题本） | 新功能 | M | 13（共用索引） |
| [09](09-global-search.md) | 全局搜索 | 新功能 | S | 11（限流接入） |
| [08](08-problem-import-export.md) | 题目导入导出（完整题 archive + FPS） | 新功能 | M | 无 |
| [12](12-llm-enhancements.md) | LLM 助手增强（对拍/validator/题面一致性） | 新功能 | M | 无 |
| [10](10-mobile.md) | 移动端适配 | 优化 | M | 无（放最后，避免与各前端改动打架） |

规模：S ≈ 半天内，M ≈ 1-3 个工作日，L ≈ 一周量级（按单 agent 估）。

## 推荐执行顺序

```
15 → 14 → { 13, 01, 11 可并行 } → 03 → 02 → 04 → 05 → 06 → 07 → 09 → 08 → 12 → 10
```

原则：先验收清理批并建 CI 安全网，再动地基（通知/限流/榜单缓存），然后上依赖地基的功能。02 与 13 都改 `server/api/contest/standings.js` 与 policy，务必串行。10（移动端）改动面全是前端高频页，放在其他前端改动落定之后。

## 公共约定（每个方案都遵循）

1. **提交**：直接提交到 `next` 分支，不发 PR。commit message 中文，风格如「站内通知 M1：数据模型 + 推送端点」。大方案按里程碑分次提交，每个里程碑可独立回归。
2. **API**：新路由一律注册在 `server/router.js`；需权限的路由用 `server/auth/middleware.js` 的 `requirePermission(key)`；新权限 key 在 `server/auth/permissions.js` 目录注册（启动时 `auth/sync.js` 自动同步到 DB），`server/auth/endpoints.js` 反查表同步补；内置角色需要新权限的话更新 permissions.js 中的角色定义。
3. **比赛域鉴权**：不写内联布尔，一律经 `server/api/contest/policy.js` 的 `resolveView` 拿 capabilities。
4. **DB 迁移**：新建 `server/db/add_<name>.sql`，幂等写法参照 `server/db/add_judgeProfile.sql`（information_schema 判存在再 ALTER），手动执行；同时更新 `docs/cloud-upgrade.md` 的升级步骤。
5. **前端**：axios 走 `web/src/assets/common.js` 封装；组件按域放 `web/src/components/<域>/`；路由在 `web/src/router/router.js`；权限键与登录态来自 `/api/auth/getSessionInfo`（Vuex store）。
6. **ECharts 在 tab 内的坑**：隐藏 tab 尺寸为 0 时 resize 会崩——跳过 0 尺寸 + try/catch，切 tab 时重渲染而非 resize。
7. **验收**：每个方案的验收清单跑绿再提交；任何方案不得破坏比赛系统 47 项回归与判题 e2e。

## Backlog（本期不做，记录备查）

- RSS / 邮件订阅比赛提醒（通知系统的自然延伸）
- 讨论区 @提及 + Markdown 编辑器升级
- 比赛报名审批制（当前公开报名/手动添加两档）
- 题目版本历史（题面/数据变更 diff 与回滚）
- 开放 API + 个人 token（供第三方工具/爬虫友好接入）
- 出题人 generator/validator 共享库
- i18n 国际化
- README「功能模块」章节拆分到 docs/（README 只留导览）
