# 权限系统迁移指南：从 `gid` 到 RBAC

本文说明如何把现有线上数据库 / 服务平滑迁移到新的权限系统。改动一次性完成，但部署节奏可控；本文给出一个保守的、零停机的步骤，也给出"直接切"的快速版本。

## 改了什么

- **数据库**：新增 `permissions` / `roles` / `role_permissions` / `user_roles` / `user_permissions` 5 张表；启动时 `CREATE TABLE IF NOT EXISTS` 自动创建。`userInfo.gid` 列在备份角色后被自动**删除**。
- **服务端**：所有 `requireRole(N)` 和 `req.session.gid` 检查全部替换为 `requirePermission(key)` / `req.can(key, scope?)`；`req.session.gid` / `getUserInfo` 响应中的 `gid` 字段不再存在。
- **前端**：所有 `store.state.gid` / `this.gid` 引用全部改为 `$can(key)` / `$canAny(...)`；store 不再保存 `gid`；`/admin/usermanage` 显示角色标签而非 `gid` 数字；新增 `/admin/permissions` 管理中心；题目和比赛页内嵌「协作者」面板。

迁移本身**幂等**：服务启动时若 `userInfo.gid` 仍存在，先按现有 gid 把内置角色 (`user` / `moderator` / `super_admin`) 写入 `user_roles`，然后 `ALTER TABLE userInfo DROP COLUMN gid`；后续重启检测到列已不在则直接跳过。

---

## 推荐部署流程（建议）

### 0. 先备份

```bash
mysqldump -u<user> -p<pass> <db> userInfo user_roles > backup-$(date +%Y%m%d).sql
```

注意备份 `userInfo`（含 gid）和已有的 `user_roles`（如果之前 PR1 已合并）。

### 1. 在 staging 跑一次

把同样代码部到一台 staging（或本地从生产拉一份 dump）：

1. `npm install`（无新依赖，可跳）
2. 启动服务，看日志：
   - 第一次启动会打印 `[auth] dropping legacy userInfo.gid column`
   - 此前若 `user_roles` 是空的，启动会先按 `gid` 回填，然后才删列
3. 跑一遍验证：`node server/auth/test.js` 应输出 `71 passed, 0 failed`
4. 浏览器验证关键链路：
   - 登录 → 导航栏只对 `user.list` 角色显示「用户管理」
   - `/admin/permissions` 三个 Tab 正常
   - 普通用户能编辑自己的题目；moderator 能编辑别人的；super admin 能改任意

### 2. 如果担心一次性切换，可以分两步

代码层无法分两步；DB 层可以**先延迟删列**：

```bash
# 启动服务时禁用 ALTER：
DISABLE_DROP_GID=1 node server/app.js
```

`sync.js` 会跳过 `ALTER TABLE userInfo DROP COLUMN gid`，其它一切照常工作。验证一段时间（24~48h）确认线上稳定后，去掉环境变量重启即可完成 drop。

> ⚠️ **注意**：即便保留 `gid` 列，应用也已不读它。你看到的列只是历史数据，新增 / 修改用户都不会再写它。

### 3. 真正部署到生产

```bash
# pull 新代码
git pull origin main

# （可选）首次切换时保留 gid 列做观察
DISABLE_DROP_GID=1 pm2 restart nywoj   # 或你的进程管理器

# 1~2 天后正式 drop：
unset DISABLE_DROP_GID
pm2 restart nywoj
```

第一次启动时日志一定会出现：

```
[auth] dropping legacy userInfo.gid column
```

如果没看到，说明 `gid` 列已经不存在了（可能上次启动已删），属于正常。

### 4. 切完之后的验收

```sql
-- gid 列应已不存在
DESCRIBE userInfo;

-- 现有 gid=2 用户应都拿到了 moderator 角色
SELECT u.uid, u.name, GROUP_CONCAT(r.`key`) AS roles
FROM userInfo u
LEFT JOIN user_roles ur ON ur.uid = u.uid
LEFT JOIN roles r ON r.id = ur.role_id
GROUP BY u.uid, u.name
LIMIT 20;

-- 检查是否有"光杆"用户（既没有任何角色，也没有任何 user_permissions），通常是新注册
SELECT COUNT(*) FROM userInfo u
WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE uid = u.uid)
  AND NOT EXISTS (SELECT 1 FROM user_permissions WHERE uid = u.uid);
```

---

## 快速版（线上能停几分钟）

```bash
# 1. 备份
mysqldump <db> > backup.sql

# 2. 部署
git pull && pm2 restart nywoj

# 3. 看日志确认 sync 跑完 + 列已删

# 4. 验证关键页面
```

启动时间通常 < 5 秒，外加一次 `ALTER TABLE userInfo DROP COLUMN gid`（对一两万用户的表来说也是秒级）。

---

## 回滚

如果上线后发现严重问题，回滚代码即可：

```bash
git revert <commit>
pm2 restart nywoj
```

但有两个细节：

1. **`gid` 列已被删除**。回滚后老代码尝试 `SELECT gid FROM userInfo` 会报错。需要先恢复列：
   ```sql
   ALTER TABLE userInfo ADD COLUMN gid INT NOT NULL DEFAULT 1;
   -- 把现有 user_roles 反向回填到 gid（可选，用于让老代码看到「正确」的角色级别）：
   UPDATE userInfo u SET gid = COALESCE(
     (SELECT MAX(r.legacy_gid) FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.uid = u.uid AND r.legacy_gid IS NOT NULL),
     1
   );
   ```
2. 新表 (`permissions` / `roles` / `role_permissions` / `user_roles` / `user_permissions`) 留着无害，老代码不会读，可以保留以便重新升级时继续使用（数据不会丢）。

为了规避「列被删 → 回滚困难」，**一定先用 `DISABLE_DROP_GID=1` 跑一段时间**再正式 drop。

---

## 上线后给用户分配角色

旧用户已通过 gid 自动映射：
- gid 1 → 无角色（普通用户）
- gid 2 → `moderator` 角色（出题 + 办赛 + 重测三合一）
- gid 3 → `super_admin` 角色（所有权限）

新用户注册默认无角色。super admin 可在 `/admin/permissions` 的「用户授权」Tab 给用户分配角色，或在题目/比赛编辑页直接添加协作者。

如果希望细分权限（比如只让 X 出题、只让 Y 办赛），把 X 的角色从 `moderator` 改为 `problem_setter`，把 Y 的角色改为 `contest_manager`，权限会自动收紧。

---

## 部署 checklist

- [ ] 数据库备份
- [ ] 代码拉到目标分支
- [ ] `npm install` 无新依赖（可跳）
- [ ] （可选）首次部署带 `DISABLE_DROP_GID=1`
- [ ] 启动服务，日志看到 `[auth] dropping legacy userInfo.gid column`（或之前已删，无此日志）
- [ ] `node server/auth/test.js` → 71 passed
- [ ] 浏览器：以 super admin 身份验证 `/admin/permissions` 可访问
- [ ] 浏览器：以普通用户身份验证编辑自己的题目能保存
- [ ] 浏览器：以 moderator 身份验证创建题目 / 比赛 / 重测正常
- [ ] 24~48h 观察期后 `unset DISABLE_DROP_GID && restart`，确认 `gid` 列被删除
