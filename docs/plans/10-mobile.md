# 方案 10：移动端适配

> 类型：优化 · 规模：M · 前置：其他前端改动落定后最后做 · 公共约定见 [00-INDEX.md](00-INDEX.md)

## 背景与目标

手机上能**看题、看榜、看提交、看讨论**（不追求手机写代码）。技术路线：CSS media query（断点 768px）+ element-plus 栅格的响应式属性，**不引入新 UI 框架、不做独立移动站**。

## 改动清单（按提交批次）

### 批次 1：布局壳

- `web/public/index.html`：确认 viewport meta（`width=device-width, initial-scale=1`）。
- `App.vue`：主内容区宽度约束改响应式（窄屏去侧边留白）；全局加一个 `.mobile-hide` / 溢出兜底样式。
- `myHeader.vue`：≤768px 折叠为汉堡按钮 + element-plus Drawer 抽屉导航（登录态/头像/通知铃铛保留在条上）；方案 09 的搜索框折叠为图标。

### 批次 2：高频页面（每页一小节，逐页提交）

- **problemList.vue（题库）**：表格列裁剪（窄屏只留 题号/标题/难度/通过率），筛选器折叠进抽屉。
- **problemView.vue（题面）**：题面全宽可读；Monaco 编辑器与自测面板窄屏默认折叠（点开可用，只读查看代码场景保住）；样例复制按钮触屏可点。
- **提交列表 / 提交详情**（web/src/components/submission/）：列表窄屏改卡片式（每条提交一张卡：题目/结果/时间两行）；详情页测试点表格横向滚动容器包裹。
- **contestMain / 榜单**：榜单表格外包 `overflow-x: auto` 容器 + 首列（名次+选手）`position: sticky`；时间轴滑块触屏可拖；比赛信息卡纵向堆叠。
- **discussion**：列表与详情页宽度自适应，markdown 内容 `max-width:100%`、代码块横向滚动。
- **indexPage**：首页模块分栏在窄屏降为单列（现有分栏配置的渲染处加断点）。
- **userInfo**：统计卡片纵向堆叠；ECharts 图表 width 100% + 初始化时按容器实际宽度（遵守 tab resize 陷阱约定）。

### 全局横向溢出治理

每页验收标准之一：375px 宽下 `document.documentElement.scrollWidth <= window.innerWidth`（无整页横向滚动；宽内容必须在自己的滚动容器内）。

## 验证方式（每批次必做）

用 preview 工具链：`preview_start` 起 web dev server → `preview_resize` mobile（375×812）→ 逐页 `preview_screenshot` + 用 `preview_eval` 断言 scrollWidth 无溢出 → 桌面尺寸（1280×800）回归截图确认未破坏原布局。深色模式若站点支持一并抽查。

## 验收标准

- [ ] 375px 宽：题库→题面→提交列表→提交详情→比赛榜单→讨论 全链路可读可点，无整页横向滚动
- [ ] 汉堡菜单/抽屉导航全部路由可达
- [ ] 1280px 桌面布局与改造前视觉一致（逐页截图对比）
- [ ] 榜单首列 sticky、宽表横向滚动顺滑
- [ ] ECharts 在窄屏 tab 内无报错

## 注意

- 排最后做：方案 01/03/07/09 都动 header 和用户页，等它们合入再适配，避免返工。
- 改样式优先 scoped CSS + media query，少动模板结构；确需两套结构时用 element-plus 的响应式属性而非 JS 判宽。
- Monaco 在移动端只求「能看」，不修输入体验（明确非目标）。
