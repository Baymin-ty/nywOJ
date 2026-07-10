# 方案 02：虚拟参赛（Virtual Participation）

> 类型：新功能 · 规模：L · 前置：方案 13（同文件改动先合入） · 公共约定见 [00-INDEX.md](00-INDEX.md)

## 背景

榜单已是事件回放引擎（`server/api/contest/standings.js`：事件时刻全存相对秒，`getRankAt(t)` 任意时刻可查）。虚拟参赛 = 把某用户的「现在」映射成「比赛内相对时刻」，把他的提交事件叠进官方事件流回放。已结束的比赛学生可"补赛"，当年选手作为 ghost 同榜竞技，封榜/OI 隐藏等语义照常生效。

**核心不变量（第一条回归断言）：官方榜单、官方最终榜、Rating、题目统计永远不被虚拟提交污染。**

## 数据模型（新建 `server/db/add_virtual.sql`，幂等写法参照 add_judgeProfile.sql）

```sql
CREATE TABLE IF NOT EXISTS contestVirtual (
  vid INT AUTO_INCREMENT PRIMARY KEY,
  cid INT NOT NULL,
  uid INT NOT NULL,
  startAt DATETIME NOT NULL,
  finishedAt DATETIME NULL,       -- 提前结束或到时自动结束时落
  UNIQUE KEY uq_cid_uid (cid, uid),
  KEY idx_uid (uid)
);
-- submission 加列（幂等 ALTER）：
-- ALTER TABLE submission ADD COLUMN virtualId INT NULL;  -- NULL = 正式提交
-- ALTER TABLE submission ADD KEY idx_cid_virtual (cid, virtualId, submitTime);
```

## 里程碑 V1：数据模型 + 虚拟时钟 policy + 提交链路

1. 迁移如上；`docs/cloud-upgrade.md` / apply_migrations.sh 更新。
2. **端点**（server/api/contest/ 下新建 `virtual.js`，router.js 注册）：
   - `startVirtual { cid }`：条件 = 比赛已结束、本人未正式参赛（不在 contestPlayer）、无未完成 VP、可见性通过 policy；落 contestVirtual。
   - `quitVirtual { cid }`：置 finishedAt（提前结束）。
   - `getVirtualState { cid }`：本人 VP 会话状态（相对时刻、剩余时间）。
3. **policy.js 虚拟时钟**：`resolveView` 开头查 viewer 的活跃 VP 会话（cid+uid，finishedAt IS NULL 且 now < startAt+时长）。命中时构造 `virtualNow = now − startAt + contest.start`，**后续所有「比赛阶段」判定（未开始/进行中/已结束、封榜窗口、迟交窗口）都用 virtualNow 而非真实 now**。先读 policy.js 现有的阶段推导代码，把「取当前时刻」收敛为一个 `nowOf(view)` 函数再替换调用点——这是本方案最容易出细节 bug 的地方，policy 的每个 capability 都要过一遍。VP 会话中的 capabilities 额外强制：`canHack=false`、不可报名、不影响管理能力。
4. **提交链路**：比赛提交入口按 policy（虚拟时钟下 canSubmit 为真）放行，落库带 `virtualId=vid`；CF 赛制 `judgeScope` 逻辑照常按（虚拟）阶段给 pretest。评测流程完全不变（worker 不关心 virtualId）。
5. **隔离核对**（全 grep 逐个过）：所有 `WHERE cid=?` 的 submission 查询——官方榜单 loadContext、rating、contestFinalStandings 固化、题目统计（getProblemStat 若含比赛提交）、hack 目标查询、体检——统一补 `AND virtualId IS NULL`；选手自己的提交列表接口则按「正式视图排 VP / VP 视图只看自己的 VP 提交」处理。

## 里程碑 V2：混合回放榜单 + 前端

1. **standings.js**：`loadContext` 增加可选 `{ virtual: {vid, uid, startAt} }` 视图参数（不与官方 ctx 共用缓存，VP 视图缓存 key=`cid:v<vid>`，TTL 短即可）。事件流 = 官方事件（ghost，原相对秒不变）+ 该 vid 的虚拟提交（`at = submitTime − startAt`）。归约器零改动。`getRankAt` 对 VP viewer 用 `t = min(now − startAt, durationSec)`，封榜掩码按同一相对刻生效（ghost 的封榜期事件同样掩码——学生能体验真实悬念）。
2. **前端**：
   - contestList / contestMain：已结束且可 VP 的比赛显示「虚拟参赛」按钮（确认弹窗说明规则）；VP 进行中顶部横幅显示虚拟倒计时 + 「结束虚拟参赛」。
   - 榜单页：ghost 行置灰 + 标记，自己高亮；时间轴滑块组件直接复用。
   - 提交列表：VP 期间默认只看自己的虚拟提交；提交详情页照常（SSE 进度不变）。
   - VP 结束后：比赛页显示「你的虚拟成绩：rank X / score Y」（getRankAt 终刻，含 ghost 合榜名次）。
3. CF 赛制 VP 收尾：VP 结束时对该 vid 过 pretest 的提交自动全量重测（复用 systest 的 per-submission rejudge，judgeScope='all'）；V2 做不完可降级为「VP 中 CF 只跑 pretest、结束不终测」并在 UI 注明，放 backlog。

## 里程碑 V3：体检 + 回归 + 文档

- `checkContest` 加 VP 相关项（如：比赛未结束不可 VP）。
- 回归脚本：5 种赛制 × VP 各断言核心语义 —— 官方榜不含虚拟事件（不变量）、OI 虚拟进行中隐藏结果、ACM 封榜掩码按虚拟时钟、CF pretest scope、作业迟交窗口按虚拟时钟；正式 47 项回归不破。进 logic 测试层（方案 14 的框架）。
- `docs/contest-system.md` 补「虚拟参赛」一节。

## 验收标准

- [ ] 不变量断言：VP 提交后，官方 getRankAt / final standings / rating / 题目统计逐字节不变
- [ ] 上述 V3 回归全绿 + 47 项回归全过
- [ ] 手测一场历史 ACM 赛 VP 全程：开始→提交→封榜悬念→结束看合榜名次
- [ ] 正式参赛者与重复 VP 被正确拒绝

## 注意

- 组队场 V1 不支持 VP（个人虚拟即可，UI 禁用并说明），记入 backlog。
- 与方案 13 都改 standings.js/policy.js，必须在 13 合入后开工。
