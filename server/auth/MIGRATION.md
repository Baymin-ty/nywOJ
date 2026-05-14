# RBAC 权限系统说明

当前权限系统以权限 key 和角色表为准：

- 权限目录定义在 `server/auth/permissions.js`。
- 服务启动时 `auth/sync.js` 会创建并同步 `permissions`、`roles`、`role_permissions`、`user_roles`、`user_permissions`。
- 用户可持有多个角色，也可拥有直接授权或拒绝项，最终权限由 `auth/policy.js` 合并计算。
- `uid=1` 是根账号，始终作为角色结构维护者。

## 管理边界

- `user.manage`：查看用户列表、编辑用户资料、封禁 / 解封、重置密码。
- `user.role.admin`：给用户分配角色、管理用户直接授权。
- `uid=1`：新建自定义角色、编辑角色权限、删除自定义角色。

## 前端入口

权限管理中心位于 `/admin/permissions`：

- 用户列表：用户资料、角色分配、直接授权、有效权限查看。
- 角色权限矩阵：查看所有角色与权限的关系；`uid=1` 可在这里编辑角色权限或新建自定义角色。
- 权限目录：查看权限 key、名称、说明和作用域能力。
- 审计日志：需要 `audit.view`。

## 验证清单

- 以拥有 `user.role.admin` 的非 `uid=1` 用户登录：可以给用户分配角色和直接授权，但看不到角色创建 / 编辑入口。
- 以 `uid=1` 登录：角色权限矩阵中可以新建自定义角色，也可以编辑任意角色权限。
- 非 `uid=1` 直接请求 `/api/auth/createRole`、`/api/auth/updateRole`、`/api/auth/deleteRole` 应返回 403。
- `/api/auth/setUserRoles`、`/api/auth/grantUserPermission`、`/api/auth/revokeUserPermission` 对 `user.role.admin` 仍保持可用。
