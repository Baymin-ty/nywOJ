const db = require('./db');

let ready = null;

const ensureGroupSchema = () => {
  if (!ready) {
    ready = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS user_groups (
          gid INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(40) NOT NULL UNIQUE,
          memberCnt INT NOT NULL DEFAULT 0,
          createTime DATETIME NOT NULL,
          KEY idx_name (name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS group_members (
          gid INT NOT NULL,
          uid INT NOT NULL,
          isAdmin TINYINT NOT NULL DEFAULT 0,
          joinTime DATETIME NOT NULL,
          PRIMARY KEY (gid, uid),
          KEY idx_uid (uid),
          KEY idx_gid_admin (gid, isAdmin)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS group_permissions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          gid INT NOT NULL,
          permission_id INT NOT NULL,
          effect ENUM('allow','deny') NOT NULL DEFAULT 'allow',
          resource_type VARCHAR(32) NULL,
          resource_id INT NULL,
          granted_by INT NULL,
          granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME NULL,
          UNIQUE KEY uniq_group_perm (gid, permission_id, effect, resource_type, resource_id),
          KEY idx_gid (gid),
          KEY idx_perm (permission_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    })();
  }
  return ready;
};

module.exports = { ensureGroupSchema };
