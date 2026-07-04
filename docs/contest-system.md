# 比赛系统

本文说明重构后（2026-07，M1–M6）比赛系统的架构：赛制声明式配置、统一权限收口、事件回放榜单引擎，以及 ACM / CF（pretest+systest+hack）/ 组队 / 作业的实现约定。

## 总览

三个核心设计：

1. **赛制 = 声明式配置**。`contest.format` 选择预设（preset），`contest.config`（JSON）保存对预设的覆盖（partial patch）。管理者可以在任何赛制下自由改「封榜 / 真实分数 / hack / 组队 / 迟交」等独立开关 —— preset 只是初始值。与 `problem.judgeProfile` 的设计哲学一致。
2. **鉴权收口到 policy**。所有 endpoint 不再写内联布尔表达式，统一通过 `policy.loadView(req, cid)` 拿 capabilities 对象，问「能不能」而不是「是什么身份」。
3. **榜单 = 事件回放**。榜单不是持久状态，而是把该场提交（+hack）按时间排序成事件流，回放到任意时刻 t 再按赛制归约。天然支持时间轴拖动、封榜掩码、选手曲线、赛后回放。

## 模块地图（server/api/contest/）

| 模块 | 职责 |
|---|---|
| `contest.js` | 薄 endpoints：CRUD、报名、列表、榜单 API、提交入口 |
| `store.js` | getContest / isReg / getContestProblems 等 DB 访问 |
| `policy.js` | **核心**：contestStatus、canManageContest、resolveView → capabilities |
| `formats.js` | 赛制注册表：preset、resolveConfig（深合并）、validateConfigPatch、legacyTypeOf |
| `standings.js` | 事件回放榜单引擎（见下） |
| `teams.js` | 队伍 CRUD、邀请码加入、队长/管理员管理 |
| `hacks.js` | CF hack 提交/列表/判定编排 |
| `health.js` | 比赛体检 checklist |
| `rating.js` | Rating 结算/重建/预览（行为与重构前一致） |
| `schema.js` | ensureContestV2Schema（代码内幂等迁移，SQL 见 db/add_contestV2.sql） |

## 数据模型

`contest` 新增列：

- `format VARCHAR(16)`：`'oi' | 'ioi' | 'acm' | 'cf' | 'homework'`。旧 `type` 列保留（0=OI/1=IOI 兼容旧读取方，由 `legacyTypeOf` 维护），API 响应仍带 `type` 字段（值为赛制中文标签）。
- `config JSON`：对 preset 的覆盖 patch（NULL = 纯预设）。
- `phase TINYINT`：CF 用，0 正常 / 1 终测进行中 / 2 终测完成。

新表：

- `contestTeam` / `contestTeamMember`：比赛级队伍（组队开关在 config，队伍数据按 cid 隔离）；`contestPlayer.teamId` 指向所属队。
- `contestHack`：hack 记录（hacker、目标提交、输入文件、status: pending/judging/success/fail/invalid）。
- `contestFinalStandings`：closeContest 时固化的官方最终榜（participantKey → rank + payload JSON）。

`submission.judgeScope`：NULL=全量评测 / `'pretest'`=只跑 pretest 测试点（CF 赛中）。

## 赛制配置（formats.js）

生效配置 = `deepMerge(preset(format), contest.config)`。所有键：

```json
{
  "scoreboard": {
    "duringContest": "none | full",     // 进行中(含等待测评)选手能否看榜
    "afterEnd": "public",               // 结束后：公开赛任何人/私有赛选手
    "freeze": { "enabled": false, "offsetMinutes": 60, "revealed": false }
  },
  "submission": { "resultVisibility": "full | none" },  // 进行中能否看自己评测结果
  "penalty": { "wrongTryMinutes": 20 },                 // ACM 错误罚时
  "team": { "enabled": false, "maxSize": 3, "allowSelfForm": true },
  "cf": {
    "pretestEnabled": true, "hackEnabled": true,
    "decayPerMinuteRatio": 0.004, "minRatio": 0.3, "wrongPenalty": 50,
    "hackReward": 100, "hackFailPenalty": 50
  },
  "late": { "enabled": true, "windowMinutes": 1440, "scoreRatio": 0.5 }  // 作业迟交
}
```

各赛制 preset 差异：

| format | 计分 | 进行中看榜/结果 | 默认封榜 | 特有配置 |
|---|---|---|---|---|
| oi | 每题最后一次提交 × weight | ✗ / ✗ | ✗ | |
| ioi | 每题历史最高分 × weight | ✓ / ✓ | ✗ | |
| acm | 过题数 + 罚时 | ✓ / ✓ | ✓（60min） | penalty |
| cf | 初始分(weight)线性衰减 − 错误罚分 ± hack 分 | ✓ / ✓ | ✗ | cf.* |
| homework | 每题最高分 × weight × 迟交系数 | ✓ / ✓ | ✗ | late.* |

管理端保存 config 时经 `validateConfigPatch(format, patch)` 白名单校验；前端只保存与 preset 不同的键（全同则存 NULL）。

## 权限模型（policy.js）

- `contestStatus`: 0 未开始 / 1 进行中 / 2 已过截止未关闭（等待测评）/ 3 已结束（done）。
- 管理权 = `(host AND contest.manage.self) OR contest.manage.any`（可按 contest 资源域授权，协作者体系）。
- `resolveView(req, contest)` → `{ contest, cfg, status, isReged, isManager, caps }`。

capabilities 关键项（完整见 policy.js 注释）：

- `canEnter / canRegister / canJoin / canViewProblems / canViewSubmissionList`
- `canSubmit`：`isReged && (status === 1 || inLateWindow)` —— 作业迟交窗口是唯一在 status=2 仍可提交的情形
- `canViewScoreboard` / `scoreboardMasked`（封榜掩码，管理员不受掩码）
- `scrubSubmissionRow`：OI 式进行中遮蔽评测结果（分数/结果/时间清零）
- `canHack / canViewHacks`（CF）、`teamMode`、`manage`

OI/IOI 的推导与重构前逐接口等价（M1 用 e2e 基线 diff 验收过）。

## 榜单引擎（standings.js）

- **事件流**：该场全部提交按 `submitTime` 排序，映射为 `{ key, idx, at(相对秒), result, score, pending }`；CF 场再加已判定的 hack 事件。每场缓存于内存（TTL 10s），`invalidateStandings(cid)` 在评测完成钩子（judge/core.js setSubmission）与管理操作时调用。
- **participantKey**：个人 `u<uid>`，组队 `t<teamId>`（`contestPlayer.teamId` 映射）。榜单代码对两种模式完全一致；组队行带 `members`。
- **归约器**（按 format 分派）：`reduceScoreFormats`（oi 取最后/ioi 取最高）、`reduceAcm`（AC+罚时，CE 等不计罚）、`reduceCf`（衰减分+hack 分，被 hack 的 AC 自 hack 时刻视为错误）、`reduceHomework`（最高有效分，迟交 × scoreRatio，`cell.late` 标记，迟交满分也计入完成度 `solved`）。
- **封榜**：`freeze.enabled` 且未解榜（`revealed`）且未 done 时，对非管理员把封榜期事件掩码为 pending 数（`?N`）。解榜 = 管理员开关（`setScoreboardReveal`）或结束比赛。
- **回放 API**：
  - `getRankAt { cid, t, pageId, pageSize }`：任意时刻分页榜单（前端时间轴滑块）。响应含 `problemStats`（每题 通过/尝试 人数）、`atSec/horizonSec/durationSec/frozen`。
  - `getParticipantTimeline { cid, participant }`：分数+排名随时间序列（选手曲线弹窗）。
  - `getRank`：兼容旧响应形状（全量、赛后带 rating join）。
- **horizon**：回放上限 = min(当前时刻, 比赛时长)；作业例外 —— 迟交窗口内 horizon 越过 deadline（`horizonLimitOf`）。
- **固化**：closeContest → `persistFinalStandings` 写 `contestFinalStandings`。历史回放本身由 submission 表天然持久。

## CF 赛制（M3）

1. **pretest**：`data/<pid>/config.json` 的 `pretests: [caseIndex...]`（数据配置页勾选）。赛中提交写 `judgeScope='pretest'`，worker 按 scope 过滤测试点，全过显示 "Pretests Passed"。
2. **hack**（简化无房间制）：本场该题已过 pretest → 锁题，可查看其他已过 pretest 提交的代码并提交 hack 输入。判定链：validator（题目资产 `assets/validator.cpp`，testlib）校验输入 → std（`assets/std.cpp`）跑期望输出 → 目标程序跑该输入 → checker 比对。目标挂 = success（目标该题回到未通过、hacker +hackReward），否则 fail（−hackFailPenalty）；输入不合法 = invalid 不计分。输入存 `server/data/hacks/<cid>/`。
3. **systest**：管理员「启动终测」（phase 0→1→2）：本场过 pretest 的提交按全量数据 + 成功 hack 数据重测，按 final 结果算分。
4. **计分**：`max(weight × minRatio, weight − weight × decayPerMinuteRatio × 过题分钟 − wrongPenalty × 错误次数)`，hack 分单列（榜单行 `hackScore/hackOk/hackFail`）。

## 组队参赛（M4）

- 任何赛制可开 `team.enabled`。报名走队伍流程（创建队/邀请码加入/退队；`allowSelfForm=false` 时仅管理员建队编辑），个人报名按钮隐藏。
- 榜单按 teamId 聚合（队内任何人的提交都算队伍的）；未组队选手的提交**不计入榜单**（体检会警告）。
- 组队场强制不产生 Rating（rating 是个人维度；`ratingIneligible` 兜底所有结算/重建/预览路径）。

## 作业（M5）

- `format='homework'`，独立入口 `/homework`（比赛列表与作业列表按 format 互斥过滤，`getContestList` 的 `kind` 参数）。
- 语义：无比赛紧张态 —— 开放期内随时提交、即时看完整结果（IOI 式取最高分）；deadline（start+length）后进入迟交窗口（`late.windowMinutes`），得分 × `late.scoreRatio`，榜单单元格带「迟」标记；窗口结束后关闭提交。
- 完成度：迟交拿满分也算「完成」（分数照折）。榜单行 `solved` = 完成题数；`problemStats` = 每题 通过/尝试 人数。
- 强制 unrated：`updateContestInfo` 落库置 0 + rating 结算侧 `ratingIneligible` 双保险。

## 比赛体检（health.js）

`checkContest(cid)` 返回分级 checklist（`ok/warn/error`），管理页「检查比赛」弹窗 + 题目管理 tab 每题状态点共用：

- 比赛级：支持语言、时长合法、进行中/已结束提醒、封榜时长、组队（maxSize、未组队选手警告）、作业（迟交窗口、Rating 开关警告）。
- 题目级：测试数据与 config、judgeProfile 资产体检（复用 profileHealth）、泄题警告（未结束但题库公开）、weight 非法、CF 的 pretest 标记 / validator+std 资产 / 交互题不可 hack / 初始分偏低。

## 前端（web/src/components/contest/）

- `contestList.vue` / `homeworkList.vue`：比赛/作业分列表，分创建入口。
- `contestMain.vue`：管理 tab 分区 —— 基本信息 / 赛制与规则（format 选择器切 preset + 独立开关）/ 危险操作（终测/重测/结束/重算）；作业模式文案裁剪 + 迟交提示条；选手侧按 format 显示差异化 tab（CF 的 Hack、组队的队伍）。
- `components/contestRank.vue`：服务端分页 + 时间轴滑块（拖动调 getRankAt，封榜/截止刻度）+ 赛制感知单元格（分数/AC+罚时/CF 分+hack/迟交标记+完成度）+ 一血高亮 + 点选手弹 echarts 双轴曲线（注意隐藏 tab 内 0 尺寸不 init/resize）。
- `components/problemManage.vue`：每题体检状态点（hover 看明细）。
- `components/hackPanel.vue` / `teamPanel.vue`：hack 面板、队伍面板。

## 兼容性

- 旧 `type` 列与 API `type` 字段保留；OI/IOI 行为 1:1（M1 回归基准）。
- `getRank` 响应结构向后兼容；新前端走 `getRankAt`。
- V2 迁移幂等：`schema.js` 启动时 ensure + `db/add_contestV2.sql` 手动通道，format 按旧 type 回填。
