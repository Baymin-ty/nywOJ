# 方案 01：站内通知系统

> 类型：新功能·公共地基 · 规模：M · 前置：方案 15 · 公共约定见 [00-INDEX.md](00-INDEX.md)

## 背景

目前没有任何用户侧通知机制（myHeader.vue 无铃铛）。赛内提问（方案 03）、题单（方案 06）、作业截止提醒都需要它，先做成通用地基。

## 数据模型（新建 `server/db/add_notification.sql`，幂等写法参照 add_judgeProfile.sql）

```sql
CREATE TABLE IF NOT EXISTS notification (
  nid INT AUTO_INCREMENT PRIMARY KEY,
  uid INT NOT NULL,                 -- 接收者
  type VARCHAR(32) NOT NULL,        -- contest_start / discussion_reply / broadcast / clar_reply / clar_public / homework_due / ...
  refType VARCHAR(16) NULL,         -- contest / discussion / clar / plist ...
  refId INT NULL,
  dedupeKey VARCHAR(64) NULL,       -- 幂等键，如 'contest_start:12'
  title VARCHAR(255) NOT NULL,
  content TEXT NULL,                -- 纯文本或极简 markdown
  link VARCHAR(255) NULL,           -- 前端路由路径，如 '/contest/12'
  isRead TINYINT NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_uid_dedupe (uid, dedupeKey),
  KEY idx_uid_read (uid, isRead, nid)
);
```

## 服务端（新建 `server/api/content/notification.js`）

- **推送 helper（模块导出，供其他模块调用）**：`push(uids, { type, refType, refId, dedupeKey, title, content, link })` — 批量 `INSERT IGNORE`（dedupeKey 撞 UNIQUE 即静默跳过，天然幂等）。uids 去重、排除触发者本人。
- **端点**（router.js 注册；登录即可访问，参照个人资料类接口的注册方式，无需新权限 key）：
  - `getNotifications { page }` — 本人通知倒序分页（20/页），返回总数与未读数
  - `getUnreadCount` — 轻量接口，只返回数字
  - `markRead { nids }` / `markAllRead`
  - `broadcast { title, content, link }` — 全站广播（写给全部 uid，分批 INSERT），权限 `user.manage`
- **开赛提醒调度**：app.js 启动 `setInterval` 每 60s 调 `scanContestReminders()`：查 `contest.start` 落在 `[now, now+30min]` 且未结束的比赛 → 对 contestPlayer 报名者 push，`dedupeKey='contest_start:<cid>'`（UNIQUE 保证只发一次）。组队场对队员同样生效（contestPlayer 里有成员即可）。
- **作业截止提醒**（同一 scanner 顺带）：format='homework' 且 deadline 在 24h 内 → 对报名且完成度 < 100% 的 uid push，`dedupeKey='homework_due:<cid>'`。完成度判断复用 standings 的作业归约（若代价大，简化为「报名即提醒」，在代码注释说明）。
- **本期接线点**（其余功能各自方案里接）：
  1. 讨论回复：`server/api/content/discussion.js` 创建回复处 → 通知讨论作者（type=discussion_reply，link=讨论页）；
  2. 管理员广播（上面端点 + 管理页入口）；
  3. 开赛 / 作业截止提醒（scanner）。
- 保留策略：scanner 顺带删 90 天前已读通知，防表膨胀。

## 前端

- **myHeader.vue**：登录态显示铃铛 + 未读 Badge；60s 轮询 `getUnreadCount` + 路由切换时刷新；点击弹下拉（最近 10 条，未读加粗），底部「全部通知 / 全部已读」。
- **通知列表页**：`web/src/components/user/notificationList.vue`，路由 `/notifications`；分页、点击条目跳 link 并 markRead。
- 广播入口：admin 管理页加一个简单表单（放 `web/src/components/admin/` 下合适位置）。

## 验收标准

- [ ] logic 测试：push 幂等（同 dedupeKey 两次只落一条）、分页/未读数正确、markRead 生效
- [ ] 开赛提醒：造一场 20 分钟后开始的比赛 + 报名两人 → scanner 跑两轮只各发一条
- [ ] 讨论回复触发通知，自己回自己不通知
- [ ] 前端铃铛红点/下拉/列表页全链路手测通过；未登录不请求通知接口
- [ ] broadcast 权限（无 user.manage 得 403）

## 注意

- 不做 WebSocket/SSE 实时推送（轮询 60s 足够，接口极轻）；将来要实时可复用 `server/api/judge/events.js` 的 EventEmitter 模式，本期不做。
- push helper 必须 try/catch 自吞错误：通知失败不能影响主流程（回复/判题等）。
