# 方案 13：榜单引擎增量缓存 + 索引体检

> 类型：优化 · 规模：M · 前置：方案 15 · 公共约定见 [00-INDEX.md](00-INDEX.md)

## 背景与现状（已核实）

`server/api/contest/standings.js`：事件回放引擎把该场全部提交拉成事件流缓存在内存（`cache = new Map()`，`CACHE_TTL_MS = 10s`，`invalidateStandings(cid)` 整体失效）。比赛进行中意味着**每 10 秒全量重拉该场所有提交**（`SELECT ... FROM submission WHERE cid=? ORDER BY submitTime`）；cache 是无界 Map，长期运行有内存隐患。榜单事件的统一出口是 `server/api/judge/core.js` 的 `setSubmission`（评测完成钩子，目前调用 invalidate）。

## 改动

### 1. 失效改增量（standings.js）

- 新增 `applyEvent(cid, submissionRow)`：若该 cid 的 ctx 在缓存中——
  - 按 `sid` 找到已有事件 → 原地更新 `result / score / runTime / pending`（评测状态推进）；
  - 找不到 → 构造新事件（复用 loadContext 内的事件构造逻辑，抽成 `buildEvent(ctx, row)`），按 `(at, sid)` 二分插入保持有序；
  - 提交者不在 `ctx.participants`（赛中新报名）或 pid 不在题目表 → 降级 `invalidateStandings(cid)`。
- `setSubmission` 钩子处改调 `applyEvent`；**提交入库时**（判题前的新提交）也要触发一次（找到比赛提交 INSERT 的位置，pending 状态的事件也参与 ACM/CF 的 pending 显示）。
- hack 判定落库处（`server/api/contest/hacks.js`）保守处理：直接 `invalidateStandings`（hack 频率低，不值得增量）。
- 队伍变更、题目增删、赛制配置修改等管理操作处：确认都已调用 invalidate（grep 现有调用点核对），漏的补上。
- TTL 放宽到 `120s` 作为兜底（增量保证新鲜度，TTL 只兜「漏钩子」的场景）。
- kill-switch：`env.STANDINGS_INCR === '0'` 时回退纯 TTL-10s 旧行为。

### 2. LRU 上限

cache 加上限（32 场）：命中时 `delete + set` 重排到 Map 尾部，超限淘汰最老（`cache.keys().next().value`）。

### 3. 索引体检（新建 `server/db/add_submissionIndexes.sql`，幂等写法参照 add_judgeProfile.sql）

- `SHOW INDEX FROM submission` 核对，缺则加：
  - `KEY idx_cid_time (cid, submitTime, sid)` — loadContext 主查询；
  - `KEY idx_uid_result (uid, judgeResult)` — 用户统计/方案 07 练习统计共用。
- 更新 docs/cloud-upgrade.md 与 apply_migrations.sh（方案 14）。

## 验收标准

- [ ] **一致性断言脚本**（进 logic 测试层）：造一场比赛 + 若干提交，随机顺序走 applyEvent，与 `cache.delete` 后全量 `loadContext` 的 ctx.events 深比较逐字段一致；覆盖「更新已有事件 / 插入新事件 / 未知选手降级」三分支。
- [ ] 比赛 47 项回归全过（含封榜/hack/组队/作业场景）。
- [ ] 手测：进行中比赛提交一发，榜单无需等 TTL 即反映（pending → 判决推进）。
- [ ] 合成压测脚本：单场 1 万提交 loadContext + 100 次 getRankAt 计时，记录到 commit message 或 docs（作为将来基准）。
- [ ] `STANDINGS_INCR=0` 回退路径可用。

## 注意

- worker 是 fork 出的子进程：确认 setSubmission 钩子运行在主进程（事件经 IPC 回主进程后触发，参照 `server/api/judge/events.js` 的 isWorker 分支模式）；若钩子在子进程执行则增量对主进程缓存无效——这是本方案第一个要核实的事实。
- 方案 02（虚拟参赛）也改 standings.js，本方案先行合入。
