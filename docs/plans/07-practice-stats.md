# 方案 07：练习统计（热力图 / 分布 / 错题本）

> 类型：新功能 · 规模：M · 前置：方案 13（共用 submission 索引） · 公共约定见 [00-INDEX.md](00-INDEX.md)

## 背景

个人主页（userInfo.vue）已有排名/AC 数/积分/提交统计，缺「过程感」：做题日历热力图、难度/标签分布、错题本。纯读层功能，风险低。

## 服务端（新建 `server/api/account/practice.js`，router.js 注册）

- `getPracticeStats { uid }`（公开，与用户主页一致的可见性）返回一次性聚合：
  - `heatmap`：近 372 天 `GROUP BY DATE(submitTime)` 的 `{date, submits, acs}`（acs = 当日 judgeResult=4 的**去重题目**数）；
  - `diffDist`：该用户 AC 过的题（去重 pid）按 problem.difficulty(0-5) 计数；
  - `tagDist`：同上按 problem.tags 计数，取 top 12（tags 是题目上的数组字段，读出后在 JS 里聚合，别在 SQL 里解析 JSON）；
  - `recentAc`：最近 20 个首次 AC 的题（pid/title/时间）。
  - 排除比赛未结束的 OI 遮蔽提交？——不用：只统计已判定提交，遮蔽是展示层语义（与现有用户页统计口径保持一致，实现时对齐现状口径并在注释说明）。
- `getWrongBook { page }`（**仅本人**，session uid 判定）：提交过但从未 AC 的题分页——`GROUP BY pid HAVING MAX(judgeResult=4)=0`，返回 pid/title/难度/尝试次数/最近提交时间/最好结果。排除已删除与对该用户不可见的题（problemAuth 批量过滤）。
- 性能：全部查询走 `(uid, judgeResult)` 或 `(uid, submitTime)` 索引（方案 13 的 add_submissionIndexes.sql 已建 idx_uid_result；heatmap 需要 `(uid, submitTime)`，本方案在同一 sql 文件补 `KEY idx_uid_time (uid, submitTime)`）。结果整体缓存 5 分钟（内存 Map，key=uid，带上限淘汰）。

## 前端（userInfo.vue 加「练习」tab）

- **热力图**：ECharts calendar heatmap（近一年，色阶按当日 AC 数，tooltip 显示提交/AC 明细）。
- **分布**：难度柱状图 + 标签 top12 横向条形图（雷达图在标签数不定时不好看，用条形图；想要雷达可作为切换）。
- **最近 AC** 时间线列表。
- **错题本**：仅本人查看自己主页时显示该区块，表格分页，行点击进题目页。
- **必须遵守 ECharts tab 陷阱约定**（00-INDEX 公共约定第 6 条）：图表在 tab 内，初始化在 tab 首次激活时做；resize 前判尺寸非 0 + try/catch；切 tab 重渲染而非 resize。

## 验收标准

- [ ] logic 测试：造用户 + 若干跨天提交，断言 heatmap 计数（AC 去重口径）、diffDist/tagDist、错题本集合正确（AC 过的题不出现；从未提交的不出现）
- [ ] 错题本他人访问 403（或返回空并明确标注，取其一并测试）
- [ ] EXPLAIN 确认三条主查询走索引，无全表扫
- [ ] 手测：切 tab 无 ECharts 报错（含窗口缩放）；数据为空的新用户页面不崩、显示占位
- [ ] 缓存：5 分钟内二次请求不落库（日志确认）

## 注意

- 别在用户主页首屏就拉练习统计（tab 激活再拉），避免拖慢现有页面。
- tagDist 只统计 AC 题，标签目录改名/删除后以题目当前 tags 数组为准（管理员标签目录操作本就会同步题目数组，见 README）。
