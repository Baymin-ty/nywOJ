# 方案 04：滚榜（ICPC 揭榜动画）

> 类型：新功能 · 规模：M · 前置：方案 13 · 公共约定见 [00-INDEX.md](00-INDEX.md)

## 背景

封榜数据引擎已齐备（standings.js 事件回放，任意时刻可查、封榜掩码可开关），滚榜基本是纯前端表演层 + 一个数据端点。V1 只支持 `format='acm'`（滚榜是 ICPC 传统；其他赛制返回明确错误，记 backlog）。

## 服务端（standings.js 加一个导出 + contest 路由）

- `computeResolverData(cid)` 返回一次性打包：
  - `sealedStandings`：回放到封榜开始时刻的完整榜（对调用者不掩码——本端点仅管理可用）；
  - `finalStandings`：终刻榜；
  - `pendingCells`：每 participant × 每题在封榜期内有提交的单元格 → `{ key, idx, attemptsBefore, finalOutcome: 'ac'|'fail', acTime?, penalty? }`（从事件流直接归约，复用现有 reducer 的中间结果，别重新实现计分）；
  - 元信息：题目列表、封榜起点、时长、一血 sid。
- 端点 `getResolverData { cid }`：条件 = 比赛已结束 + 比赛管理 capability（policy resolveView）。数据量 = 单场规模，一次返回，无分页。

## 前端（新页面 `web/src/components/contest/resolverPage.vue`，路由 `/contest/:cid/resolver`）

- 全屏深色页面（投影仪场景），进入时一次拉取 getResolverData，之后纯本地状态机：
  1. 初始显示 sealedStandings（pending 单元格黄色 `?N`）；
  2. 光标从最后一名开始：逐个揭示该行 pending 单元格（黄→绿 AC / 红 Fail），若揭示后名次上升则整行上浮动画，光标跟随继续处理新的末位；
  3. 一行所有 pending 处理完且名次稳定 → 该行「定格」，光标上移一行；
  4. 全部定格后显示冠军定格画面。
- 操作：空格/→ = 下一步，←= 回退一步（状态机记录历史），A = 自动播放（可调速），Esc 退出。
- 动画：`<transition-group>` FLIP 做行位移；揭示时单元格闪烁；一血单元格特殊标记。不引入新依赖。
- 榜单页（管理视图、比赛已结束）加「滚榜」入口按钮。

## 验收标准

- [ ] logic 测试：造一场带封榜的 ACM 赛（若干封榜期提交，含翻盘剧情），断言 pendingCells 的 finalOutcome/罚时与 finalStandings 一致；resolver 状态机走到底的最终名次 === finalStandings（把状态机核心归约抽成可在 node 侧跑的纯函数来断言，或者后端直接断言 sealed+pendingCells 可推导出 final）
- [ ] 非 acm 赛制请求返回明确错误文案
- [ ] 非管理 403；比赛未结束 403
- [ ] 手测：全流程键盘操作 + 自动播放，回退可用，动画不跳变
- [ ] 47 项回归不破（computeResolverData 是只读新增，不动现有 reducer 行为）

## 注意

- 若现有 reducer 的中间结构拿不到 per-cell 明细，宁可在 computeResolverData 里对事件流做一次独立归约（只读、逻辑简单），也不要为此改动现有 reducer 的返回结构。
- 人名/队名过长截断；100+ 参赛规模下动画性能注意（虚拟滚动不必要，定格行可移出动画层）。
