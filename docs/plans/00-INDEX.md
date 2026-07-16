# nywOJ 下一阶段开发方案总索引

2026-07-10 拟定，2026-07-16 清理：已落地的方案文档删除（内容以代码与 commit 为准），
本目录只保留**未完成**的方案。

## 已完成（方案文档已删，记录对应 commit）

| 方案 | commit |
|------|--------|
| 15 Legacy 判题退役验收 | `0c504276` 清理：退役 legacy 判题分支 + 废弃模块下线 |
| 14 回归测试收敛进 CI | `19fc2b1e` 夯实 M1：logic/e2e 分层 + GitHub Actions |
| 13 榜单引擎增量缓存 + 索引 | `b2118f37` 夯实 M2：榜单引擎增量缓存 + submission 索引 |
| 01 站内通知系统 | `3c505539` 新功能：站内通知系统 |
| 11 安全加固（限流/登录退避） | `63d79b9a` 夯实：安全加固 |
| 03 赛内提问 Clarification | `9ca9f2d3` 新功能：赛内提问 |

## 待做方案

| # | 方案 | 类型 | 规模 | 前置依赖 | 状态 |
|---|------|------|------|---------|------|
| [02](02-virtual-participation.md) | 虚拟参赛 | 新功能 | L | — | **进行中**：`virtualStore.js` + `add_virtual.sql` 已落地，缺路由/榜单接线/前端 |
| [04](04-resolver.md) | 滚榜（ICPC 揭榜动画） | 新功能 | M | — | 未开始 |
| [05](05-plagiarism.md) | 代码查重（算法层 + LLM 判读） | 新功能 | L | — | 未开始 |
| [06](06-problem-lists.md) | 题单 / 训练计划 | 新功能 | M | — | 未开始 |
| [07](07-practice-stats.md) | 练习统计（热力图/分布/错题本） | 新功能 | M | —（索引已就绪） | 未开始 |
| [09](09-global-search.md) | 全局搜索 | 新功能 | S | —（限流已就绪） | 未开始 |
| [08](08-problem-import-export.md) | 题目导入导出（archive + FPS） | 新功能 | M | — | 未开始 |
| [12](12-llm-enhancements.md) | LLM 助手增强（对拍/validator） | 新功能 | M | — | 未开始 |
| [10](10-mobile.md) | 移动端适配 | 优化 | M | 放最后 | 未开始 |

规模：S ≈ 半天内，M ≈ 1-3 个工作日，L ≈ 一周量级（按单 agent 估）。

## 推荐执行顺序

```
02（收尾） → 04 → 05 → 06 → 07 → 09 → 08 → 12 → 10
```

02 与已合入的榜单缓存都改 `server/api/contest/standings.js` 与 policy，改动时注意回归。
10（移动端）改动面全是前端高频页，放在其他前端改动落定之后。

## 公共约定（每个方案都遵循）

1. **提交**：直接提交到 `next` 分支，不发 PR。commit message 中文，风格如「站内通知 M1：数据模型 + 推送端点」。大方案按里程碑分次提交，每个里程碑可独立回归。
2. **API**：新路由一律注册在 `server/router.js`；需权限的路由用 `server/auth/middleware.js` 的 `requirePermission(key)`；新权限 key 在 `server/auth/permissions.js` 目录注册（启动时 `auth/sync.js` 自动同步到 DB），`server/auth/endpoints.js` 反查表同步补；内置角色需要新权限的话更新 permissions.js 中的角色定义。
3. **比赛域鉴权**：不写内联布尔，一律经 `server/api/contest/policy.js` 的 `resolveView` 拿 capabilities。
4. **DB 迁移**：新建 `server/db/add_<name>.sql`，幂等写法参照 `server/db/add_judgeProfile.sql`（information_schema 判存在再 ALTER）；同时加进 `deploy/upgrade/cloud-upgrade.sh` 的迁移清单。云端维护流程见 [docs/ops-maintenance.md](../ops-maintenance.md)。
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
