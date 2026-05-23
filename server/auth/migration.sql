-- =============================================================================
-- nywOJ: c54fbff → HEAD 数据库迁移脚本
--
-- 作用：把旧库（仅 userInfo.gid 表示用户级别）升级到 RBAC 权限体系。
--   1. 建 5 张权限相关的新表
--   2. 写入权限目录 + 内置角色
--   3. 按旧 gid 把存量用户回填到 user_roles
--   4. 删掉 userInfo.gid 列
--
-- 幂等：可以重复执行；中途失败再跑一次也安全。
-- 用法：mysql -u<user> -p<pass> <database> < migration.sql
-- 备份：执行前请 `mysqldump` 一份 userInfo / 整库（删列不可逆）。
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 1;

-- -----------------------------------------------------------------------------
-- Step 1. 建表
-- -----------------------------------------------------------------------------

-- 权限目录：每个 key 一行，scopable=1 的可以做资源级授权
CREATE TABLE IF NOT EXISTS permissions (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  `key`        VARCHAR(64)  NOT NULL UNIQUE,
  `group`      VARCHAR(32)  NOT NULL,
  name         VARCHAR(64)  NOT NULL,
  description  VARCHAR(255) NULL,
  scopable     TINYINT      NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 角色：builtin=1 由代码维护（重启后会被覆写）。旧 gid→角色的映射不落库，
-- 仅在 Step 5 回填时内联，因此这里不再有 legacy_gid 列。
CREATE TABLE IF NOT EXISTS roles (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  `key`        VARCHAR(64)  NOT NULL UNIQUE,
  name         VARCHAR(64)  NOT NULL,
  description  VARCHAR(255) NULL,
  builtin      TINYINT      NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 兼容：若此前跑过带 legacy_gid 的旧版脚本，把残留列删掉（不存在则跳过）。
SET @roles_legacy := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'roles' AND column_name = 'legacy_gid'
);
SET @drop_roles_legacy := IF(@roles_legacy > 0,
  'ALTER TABLE roles DROP COLUMN legacy_gid',
  'SELECT ''roles.legacy_gid not present, skip'' AS msg'
);
PREPARE stmt FROM @drop_roles_legacy;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 角色 ↔ 权限多对多
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        INT NOT NULL,
  permission_id  INT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 用户 ↔ 角色（一个用户可以多角色）
CREATE TABLE IF NOT EXISTS user_roles (
  uid         INT NOT NULL,
  role_id     INT NOT NULL,
  granted_by  INT NULL,
  granted_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (uid, role_id),
  INDEX idx_role (role_id),
  CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 用户直接授权 / 拒绝（可带资源 scope、可带过期时间）
CREATE TABLE IF NOT EXISTS user_permissions (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  uid           INT NOT NULL,
  permission_id INT NOT NULL,
  effect        ENUM('allow','deny') NOT NULL DEFAULT 'allow',
  resource_type VARCHAR(32) NULL,
  resource_id   INT         NULL,
  granted_by    INT         NULL,
  granted_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    DATETIME    NULL,
  UNIQUE KEY uniq_user_perm (uid, permission_id, effect, resource_type, resource_id),
  INDEX idx_uid (uid),
  INDEX idx_resource (resource_type, resource_id),
  CONSTRAINT fk_up_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -----------------------------------------------------------------------------
-- Step 2. 写入权限目录（17 项，与 server/auth/permissions.js 对齐）
--
-- 重复执行时由 UNIQUE(`key`) + ON DUPLICATE 兜底，name/description/scopable 会被刷新。
-- -----------------------------------------------------------------------------
INSERT INTO permissions (`key`, `group`, name, description, scopable) VALUES
  ('problem.create',             'problem', '创建题目',       '创建新题目',                                                       0),
  ('problem.manage.any',         'problem', '管理任意题目',   '编辑/删除/管理测试数据 任意题目',                                  1),
  ('problem.manage.self',        'problem', '管理自己的题目', '编辑/删除/管理自己创建题目的测试数据',                             0),
  ('problem.view.any',           'problem', '查看所有题目',   '查看题目（含非公开）及其非比赛提交。可被全局或单题授予',           1),
  ('problem.solmanage',          'problem', '管理题解绑定',   '绑定/解绑自己可查看题目的题解，不包含编辑他人 paste',              0),
  ('contest.create',             'contest', '创建比赛',       NULL,                                                               0),
  ('contest.manage.any',         'contest', '管理任意比赛',   '编辑/管理选手/查看提交/重测提交 任意比赛',                         1),
  ('contest.manage.self',        'contest', '管理自己的比赛', '编辑/管理选手/查看提交/重测提交 自己创建的比赛',                   0),
  ('submission.view.any',        'judge',   '查看任意提交',   '查看所有提交详情/代码（含比赛与非比赛）',                          0),
  ('submission.view.notcontest', 'judge',   '查看非比赛提交', '查看所有非比赛提交详情/代码',                                      0),
  ('submission.rejudge.any',     'judge',   '重测任意提交',   '重测任意提交（含比赛与非比赛）',                                   0),
  ('submission.rejudge.self',    'judge',   '重测自己的提交', '重测自己提交的非比赛代码',                                         0),
  ('user.manage',                'user',    '用户管理',       '查看用户列表 / 编辑用户资料 / 封禁与解封用户',                     0),
  ('user.role.admin',            'user',    '用户授权管理',   '分配用户角色 / 单点授权',                                          0),
  ('announcement.manage',        'system',  '管理公告',       NULL,                                                               0),
  ('paste.edit.any',             'system',  '编辑他人 paste', NULL,                                                               0),
  ('audit.view',                 'system',  '查看审计日志',   NULL,                                                               0)
ON DUPLICATE KEY UPDATE
  `group`     = VALUES(`group`),
  name        = VALUES(name),
  description = VALUES(description),
  scopable    = VALUES(scopable);

-- -----------------------------------------------------------------------------
-- Step 3. 写入内置角色（7 个，与 BUILTIN_ROLES 对齐）
-- -----------------------------------------------------------------------------
INSERT INTO roles (`key`, name, description, builtin) VALUES
  ('user',            '普通用户',     '默认角色，无额外权限',                  1),
  ('problem_setter',  '出题人',       '可创建/编辑题目并管理数据',             1),
  ('contest_manager', '比赛管理员',   '可创建并管理比赛',                      1),
  ('judge_admin',     '判题管理员',   '可重测并查看所有提交',                  1),
  ('solution_admin',  '题解管理员',   '可管理自己可查看题目的题解绑定',        1),
  ('moderator',       '管理员',       '出题/办赛/判题三合一',                  1),
  ('super_admin',     '超级管理员',   '拥有全部权限',                          1)
ON DUPLICATE KEY UPDATE
  name        = VALUES(name),
  description = VALUES(description),
  builtin     = 1;

-- -----------------------------------------------------------------------------
-- Step 4. 写入角色 ↔ 权限映射
--   注意：先清掉所有 builtin 角色现有的映射，再重建。这样脚本可重复执行，
--   且未来权限目录调整后再跑一遍就能同步。自定义角色不受影响。
-- -----------------------------------------------------------------------------
DELETE rp FROM role_permissions rp
  JOIN roles r ON r.id = rp.role_id
  WHERE r.builtin = 1;

-- problem_setter
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.`key` IN ('problem.create', 'problem.manage.self', 'problem.view.any')
  WHERE r.`key` = 'problem_setter';

-- contest_manager
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.`key` IN ('contest.create', 'contest.manage.any', 'contest.manage.self')
  WHERE r.`key` = 'contest_manager';

-- judge_admin
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.`key` IN ('submission.view.any', 'submission.rejudge.any')
  WHERE r.`key` = 'judge_admin';

-- solution_admin
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.`key` = 'problem.solmanage'
  WHERE r.`key` = 'solution_admin';

-- moderator = 全部 17 项里排除 {user.role.admin, submission.rejudge.self,
--             submission.view.notcontest}，共 14 项。
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.`key` IN (
    'problem.create', 'problem.manage.any', 'problem.manage.self',
    'problem.solmanage', 'problem.view.any',
    'contest.create', 'contest.manage.any', 'contest.manage.self',
    'submission.view.any', 'submission.rejudge.any',
    'user.manage',
    'announcement.manage', 'audit.view', 'paste.edit.any'
  )
  WHERE r.`key` = 'moderator';

-- super_admin 拿所有权限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
  WHERE r.`key` = 'super_admin';

-- -----------------------------------------------------------------------------
-- Step 5. 把存量用户按 gid 回填到 user_roles
--   gid=1 → role 'user'，gid=2 → 'moderator'，gid=3 → 'super_admin'。
--   只在 userInfo.gid 列还存在时执行；INSERT IGNORE 保证可重复。
-- -----------------------------------------------------------------------------
SET @gid_exists := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'userInfo' AND column_name = 'gid'
);

SET @backfill_sql := IF(@gid_exists > 0,
  'INSERT IGNORE INTO user_roles (uid, role_id, granted_by)
     SELECT u.uid, r.id, NULL
       FROM userInfo u
       JOIN roles r ON r.`key` = CASE u.gid
         WHEN 1 THEN ''user''
         WHEN 2 THEN ''moderator''
         WHEN 3 THEN ''super_admin''
       END
      WHERE u.gid IN (1,2,3)',
  'SELECT ''userInfo.gid already dropped, skip backfill'' AS msg'
);
PREPARE stmt FROM @backfill_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- Step 6. 删掉 userInfo.gid 列
--   ⚠ 不可逆：执行前确认 Step 5 已经跑完且 user_roles 中至少有 moderator/super_admin。
--   如果想保留一段灰度期，注释掉本段，等观察稳定后再单独执行。
-- -----------------------------------------------------------------------------
-- SET @drop_sql := IF(@gid_exists > 0,
--   'ALTER TABLE userInfo DROP COLUMN gid',
--   'SELECT ''userInfo.gid already dropped'' AS msg'
-- );
-- PREPARE stmt FROM @drop_sql;
-- EXECUTE stmt;
-- DEALLOCATE PREPARE stmt;

-- =============================================================================
-- 完工。可选自检（不影响迁移）：
  SELECT `key`, name, scopable FROM permissions ORDER BY id;
  SELECT r.`key`, COUNT(rp.permission_id) AS perm_cnt
    FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
    GROUP BY r.id ORDER BY r.id;
  SELECT r.`key`, COUNT(ur.uid) AS user_cnt
    FROM roles r LEFT JOIN user_roles ur ON ur.role_id = r.id
    GROUP BY r.id ORDER BY r.id;
-- =============================================================================
