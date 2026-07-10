# 方案 15：Legacy 判题退役验收 + 提交清理批

> 类型：夯实 · 规模：S · 前置：无（最先执行） · 公共约定见 [00-INDEX.md](00-INDEX.md)

## 背景与现状

judgeProfile 声明式评测引擎已是默认路径且等价性早已证明（传统 A+B 题 legacy ↔ engine 逐字一致）。当前工作区有一大批 **staged 未提交** 的清理改动（90 文件，+3475/−5558），已删除：`server/api/judge/socketBridge.js`、`submissionApi.js`、`submissionSocket.js`、`clients.js`、`server/api/system/maintenance.js`、`server/api/content/discussionPortal.js`、`server/corsAssets.js` 等，且 `server/api/judge/worker.js` 中已 grep 不到 legacy / JUDGE_LEGACY 分支。

本方案 = 对这批删除做系统性验收，全绿后提交。**不新增功能。**

## 步骤

1. **残留引用扫描**：全仓 grep `legacy`、`JUDGE_LEGACY`、以及每个被删文件名（`socketBridge`、`submissionApi`、`submissionSocket`、`discussionPortal`、`maintenance`、`corsAssets`、`clients`），确认代码（server/ + web/src/）与文档（README、docs/）中无悬挂引用；有则清理并一并 stage。
2. **启动冒烟**：`node server/app.js` 能正常启动（auth/sync reconcile 无报错）；前端 `npm run build` 通过。
3. **judgeProfile 审计**：`node server/db/audit_profiles.js` 退出码 0（全部存量题 profile 体检无错）。
4. **判题 e2e 全套**（真 forked worker + 活 Rust sandbox，:5050）：传统 AC/WA、SPJ（含部分分 quitp）、答案提交、函数题（多文件槽 submitMulti）、交互题 AC/WA/TLE、通信题 AC/WA。历史 e2e 脚本在 `server/scripts/` 下找（如 aiAssistantE2E.js 同目录）；缺哪个补哪个。
5. **比赛回归**：跑比赛系统 47 项回归脚本（M6 交付物，`server/scripts/` 或 `server/` 下找；grep「47」或「回归」定位），全过。
6. **文档核对**：`docs/judge-pipeline.md` 若仍描述 JUDGE_LEGACY kill-switch / legacy 兜底语义，更新为「已退役」；README 判题相关章节核对。
7. **提交**：验收全绿后把 staged 批直接提交到 next（约定不发 PR）。commit message 概括这批清理的实际内容（如「清理：退役 legacy 判题分支与废弃模块（socketBridge/submissionApi/discussionPortal 等）」）。**若任何验收项失败：不提交，输出失败报告等用户定夺。**
8. 注意工作区还有少量 **未 staged** 改动（`sandbox/crates/sandbox-web/Cargo.toml`、`main.rs`、`server/scripts/aiAssistantE2E.js`、`web/jsconfig.json` 等）与未跟踪文件，检视内容：属于同一批清理的一并提交，属于半成品的留在工作区并在报告中说明。

## 验收标准

- [ ] 残留扫描 0 命中（或全部清理）
- [ ] 后端启动 + 前端 build 通过
- [ ] audit_profiles 退出码 0
- [ ] 判题 e2e 六类题型全绿
- [ ] 比赛 47 项回归全过
- [ ] 已提交，`git status` 干净（或仅剩明确说明的半成品）
