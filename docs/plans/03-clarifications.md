# 方案 03：赛内提问（Clarification）

> 类型：新功能 · 规模：M · 前置：方案 01（通知系统） · 公共约定见 [00-INDEX.md](00-INDEX.md)

## 背景

比赛进行中选手无法向管理员提问，校内联考刚需。模型：选手提问（可关联题目）→ 管理员私回或转全场公告；公告广播给全体参赛者；选手端红点提醒。

## 数据模型（新建 `server/db/add_clarification.sql`，幂等写法参照 add_judgeProfile.sql）

```sql
CREATE TABLE IF NOT EXISTS contestClar (
  clarId INT AUTO_INCREMENT PRIMARY KEY,
  cid INT NOT NULL,
  uid INT NOT NULL,                -- 提问者；管理员主动公告时 = 管理员 uid
  pid INT NULL,                    -- 关联题目（可空 = 一般问题）
  question TEXT NOT NULL,          -- 管理员主动公告时存公告正文，question 前缀标记见下
  answer TEXT NULL,
  answeredBy INT NULL,
  isPublic TINYINT NOT NULL DEFAULT 0,  -- 1 = 全场可见（公告）
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  answeredAt DATETIME NULL,
  KEY idx_cid (cid, clarId)
);
```

管理员主动公告 = 直接插入 `isPublic=1、answer=正文、question=''` 的行，前端按「公告」样式渲染。

## 服务端（新建 `server/api/contest/clar.js`，router.js 注册；鉴权全走 policy resolveView capabilities）

- `submitClar { cid, pid?, question }`：条件 = 参赛者且比赛进行中（policy 给的对应 capability；虚拟参赛者不可提问）。长度 ≤ 2000 字。限流：每 uid 每 5 分钟 3 条（方案 11 的 rateLimit，若 11 未合入则先内联简单节流）。
- `listClars { cid }`：选手 = 自己的提问 + 全部公开条目；管理 = 全部。按 clarId 倒序，不分页（单场量小）。
- `answerClar { clarId, answer, isPublic }`：比赛管理 capability。落 answer/answeredBy/answeredAt/isPublic。
- `postAnnouncement { cid, content }`：管理直接发全场公告（如上模型）。
- **通知接线**（方案 01 的 push helper）：
  - 私回 → 通知提问者（type=clar_reply，link=比赛提问 tab）；
  - 公开回复 / 公告 → 通知全体参赛者（type=clar_public，dedupeKey=`clar_public:<clarId>`）；组队场通知到所有队员。
  - 新提问 → 通知比赛创建者（管理员侧红点）。

## 前端

- `contestMain.vue` 加「提问」tab（组件放 `web/src/components/contest/components/`）：
  - 选手视图：公告置顶（高亮样式）、我的提问列表（待回复/已回复状态）、提问表单（题目下拉可选）。
  - 管理视图：全部提问倒序，未回复标红；行内回复框 + 「公开」开关；顶部「发公告」按钮。
- 红点：进行中比赛页内，tab 上的未读 Badge —— 用通知系统的未读数（refType=clar 且 refId=cid 的未读），或简化为 localStorage 记录已读最大 clarId 与 listClars 比较（选实现简单的，注明取舍）。
- 比赛进行中每 60s 轮询 listClars（仅当比赛页打开时）。

## 验收标准

- [ ] logic 测试：提问/私回/公开/公告全链路；非参赛者提问 403；比赛结束后提问被拒；私回仅提问者可见、公开全员可见
- [ ] 通知：私回只通知提问者；公告通知全体参赛者且幂等
- [ ] 管理页未回复计数正确
- [ ] 手测：双浏览器（选手 + 管理员）走一遍完整流程
- [ ] 比赛 47 项回归不破

## 注意

- OI 赛制「进行中遮蔽」只遮评测结果与榜单，不影响提问功能。
- 提问内容原样存储、前端渲染纯文本（防 XSS，不给 markdown）；公告可用 markdown（与站内公告一致的渲染组件）。
