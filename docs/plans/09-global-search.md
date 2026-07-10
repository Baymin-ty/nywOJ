# 方案 09：全局搜索

> 类型：新功能 · 规模：S · 前置：方案 11（限流接入点） · 公共约定见 [00-INDEX.md](00-INDEX.md)

## 背景与现状（已核实）

题库搜索目前是 `server/api/problem/core.js:598` 的 `(title LIKE ? OR description LIKE ?)`；讨论只有标题搜索；无跨域的全局搜索框。

**关于 FULLTEXT 的预警**：站点跑 MariaDB / MySQL 二选一。MySQL ≥ 5.7 有 ngram parser（中文可用），**MariaDB 没有 ngram**，内置全文索引对中文基本无效。因此：先探测 `SELECT VERSION()`——是 MySQL 才做 FULLTEXT 优化；MariaDB 保持 LIKE（校内数据量完全够用），**不要无脑建索引**。本方案主体价值在「聚合入口 + 讨论内容可搜」，FULLTEXT 只是可选加速。

## 服务端（新建 `server/api/content/search.js`，router.js 注册）

- `globalSearch { keyword }`（登录与否均可用，结果按调用者可见性过滤）：
  - keyword trim 后长度 2~50，否则拒绝；
  - 并行四路查询，各自截断：
    - **problems ≤ 5**：现有题库查询条件复用（title/description LIKE + 可见性过滤——未公开题目对无权者不出现，复用 problem list 接口的同一份过滤逻辑，别重写）；纯数字 keyword 额外精确匹配 pid 置顶；
    - **contests ≤ 3**：标题 LIKE + 可见性；
    - **discussions ≤ 5**：标题 **或内容** LIKE + 公开状态过滤（内容匹配时返回命中片段 ±40 字符做摘要）；
    - **users ≤ 3**：用户名/昵称前缀匹配（已有用户搜索接口的逻辑可复用）；
  - 返回 `{ problems, contests, discussions, users }`，每项含跳转所需的 id/标题/类型徽标字段。
- 限流：方案 11 的 `rateLimit('search', 30/min)`；11 未合入则先不限，留 TODO 注释。
- 讨论列表接口顺带支持 `content` 搜索参数（讨论区页面的搜索框同步支持按内容搜）。
- 可选（仅确认为 MySQL≥5.7 时，独立 commit）：`server/db/add_fulltext.sql` 对 `problem(title, description)`、讨论内容表建 `FULLTEXT ... WITH PARSER ngram`，查询切 `MATCH...AGAINST`；MariaDB 环境该文件跳过（脚本内探测版本，不适用则打印说明并退出 0）。

## 前端

- **myHeader.vue** 加搜索框（桌面端常驻，窄屏折叠为图标）：
  - 快捷键 `/` 聚焦（在非输入框焦点时）；
  - 输入防抖 300ms 调 globalSearch，下拉分组展示（题目/比赛/讨论/用户 四组，各组带图标），键盘上下选择 + 回车跳转；
  - 空结果显示「无结果」；接口 429 时提示稍后再试。
- 不做独立搜索结果页（下拉已覆盖 ≤16 条的展示量；需要更多结果时引导用户去对应列表页带 filter——题库/讨论列表本就有搜索参数）。

## 验收标准

- [ ] logic 测试：四路结果正确性与截断；**可见性**——私有题/隐藏讨论对无权用户不出现在结果（重点测）；keyword 长度校验；纯数字 pid 直达
- [ ] 讨论内容命中返回摘要片段
- [ ] 手测：`/` 聚焦、防抖、键盘导航、跳转正确；窄屏折叠可用
- [ ] MariaDB 环境下 add_fulltext.sql 安全跳过（若做了可选项）

## 注意

- LIKE '%kw%' 无法走索引——这是已知且接受的（数据量小）；别为了性能把 description 匹配去掉，题面搜索是核心价值。
- 转义 keyword 中的 `%`/`_`（LIKE 通配符注入会导致误匹配）。
