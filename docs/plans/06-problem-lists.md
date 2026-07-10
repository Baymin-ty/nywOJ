# 方案 06：题单 / 训练计划

> 类型：新功能 · 规模：M · 前置：方案 01（通知接线可选） · 公共约定见 [00-INDEX.md](00-INDEX.md)

## 背景

老师/出题人建有序题目集合 + 说明，学生领取后可见完成进度；相当于不限时的作业，练习体系骨架。与比赛/作业的区别：无时间窗、无榜单、纯进度。

## 数据模型（新建 `server/db/add_problemList.sql`，幂等写法参照 add_judgeProfile.sql）

```sql
CREATE TABLE IF NOT EXISTS problemList (
  plid INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,            -- markdown
  creatorUid INT NOT NULL,
  isPublic TINYINT NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS problemListItem (
  plid INT NOT NULL, pid INT NOT NULL,
  idx INT NOT NULL,                 -- 排序
  note VARCHAR(255) NULL,           -- 每题备注（如「必做」「提高」）
  PRIMARY KEY (plid, pid), KEY idx_order (plid, idx)
);
CREATE TABLE IF NOT EXISTS problemListEnroll (
  plid INT NOT NULL, uid INT NOT NULL,
  enrolledAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (plid, uid), KEY idx_uid (uid)
);
```

## 权限（server/auth/permissions.js 注册 + endpoints.js 反查表）

- 新 key：`plist.create`（建题单）、`plist.manage.any`（管理任意题单）；创建者天然管理自己的（creatorUid 判断，与 problem.manage.self 同模式）。
- 内置角色：`problem_setter` / `contest_manager` / `moderator` 加 `plist.create`；`moderator` 加 `plist.manage.any`。

## 服务端（新建 `server/api/content/problemList.js`，router.js 注册）

- 管理端：`createList / updateList { title, description, isPublic } / deleteList / setItems { plid, items:[{pid, note}] }`（整表替换式保存，idx 按数组序；校验 pid 存在）。
- 浏览端：
  - `getLists { page, filter }`：公开题单 + 自己创建的；返回题数、领取人数、当前用户进度（已领取时）。
  - `getListDetail { plid }`：题单信息 + items（每题：题号/标题/难度/标签 + 当前用户状态 AC/尝试过/未做）。**可见性**：未公开的题目在列表中显示为锁定行（只显示 pid 与「未公开」，不泄题面），点击走 problemAuth 正常拦截；题单本身 isPublic=0 时仅创建者与 plist.manage.any 可见。
  - `enroll / unenroll { plid }`（登录即可）。
  - `getListProgress { plid }`：创建者/管理视角——每个领取者 × 每题完成矩阵 + 完成度排序（一条 SQL：enrolled uid × items pid LEFT JOIN AC 提交 EXISTS）。
- 用户状态查询按 `EXISTS(submission WHERE uid=? AND pid=? AND judgeResult=4)`，批量题目用一次 `IN` 查询聚合，别循环查库。
- 通知接线（可选，方案 01 已合入时）：题单更新（加题）→ 通知领取者，dedupeKey 带 updatedAt 时间戳。

## 前端

- 路由 `/training`：`web/src/components/problem/trainingList.vue`（题单卡片列表：标题/题数/领取数/我的进度条）+ `trainingDetail.vue`（说明 md 渲染、题目表格带状态列 ✓/半/—、领取按钮、创建者视角多一个「完成度统计」tab）。
- 编辑器：创建/编辑页（有 plist.create 才见入口）：基本信息 + 题目挑选（按 pid 添加 + 拖拽排序，element-plus 现有交互组件优先，避免新依赖）。
- `userInfo.vue` 加「我的训练」区块：已领取题单 + 进度条。
- 首页可选：indexPage 的模块化配置里加「热门题单」块（复用 homepage 配置机制，管理后台可开关）——做不完记 backlog。

## 验收标准

- [ ] logic 测试：CRUD/权限矩阵（无 plist.create 403、非创建者改题单 403、manage.any 可改）、进度计算正确（AC/尝试/未做三态）、未公开题目不泄题面字段
- [ ] getListProgress 一次查询返回矩阵，100 人 × 50 题规模下无 N+1
- [ ] 手测：建题单→领取→做题 AC→进度实时正确；进度条与详情页状态一致
- [ ] 47 项回归与判题 e2e 不受影响（纯新增读层）
