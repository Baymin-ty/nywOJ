const db = require('../db');
const { PERMISSIONS, BUILTIN_ROLES } = require('./permissions');

const ensureSchema = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS permissions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      \`key\`        VARCHAR(64)  NOT NULL UNIQUE,
      \`group\`      VARCHAR(32)  NOT NULL,
      name         VARCHAR(64)  NOT NULL,
      description  VARCHAR(255) NULL,
      scopable     TINYINT      NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      \`key\`        VARCHAR(64)  NOT NULL UNIQUE,
      name         VARCHAR(64)  NOT NULL,
      description  VARCHAR(255) NULL,
      builtin      TINYINT      NOT NULL DEFAULT 0,
      legacy_gid   TINYINT      NULL UNIQUE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id        INT NOT NULL,
      permission_id  INT NOT NULL,
      PRIMARY KEY (role_id, permission_id),
      CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
      CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_roles (
      uid         INT NOT NULL,
      role_id     INT NOT NULL,
      granted_by  INT NULL,
      granted_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (uid, role_id),
      INDEX idx_role (role_id),
      CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.query(`
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
};

const syncPermissions = async () => {
  for (const [key, meta] of Object.entries(PERMISSIONS)) {
    await db.query(
      `INSERT INTO permissions (\`key\`, \`group\`, name, description, scopable)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE \`group\`=VALUES(\`group\`), name=VALUES(name),
                               description=VALUES(description), scopable=VALUES(scopable)`,
      [key, meta.group, meta.name, meta.description || null, meta.scopable ? 1 : 0]
    );
  }
};

const syncBuiltinRoles = async () => {
  const permRows = await db.query('SELECT id, `key` FROM permissions');
  const permIdByKey = new Map(permRows.map((r) => [r.key, r.id]));

  for (const [key, meta] of Object.entries(BUILTIN_ROLES)) {
    await db.query(
      `INSERT INTO roles (\`key\`, name, description, builtin, legacy_gid)
       VALUES (?,?,?,1,?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), description=VALUES(description),
                               builtin=1, legacy_gid=VALUES(legacy_gid)`,
      [key, meta.name, meta.description || null, meta.legacy_gid]
    );
    const role = await db.one('SELECT id FROM roles WHERE `key`=?', [key]);

    // Reset permissions for builtin roles to keep them in sync with code.
    await db.query('DELETE FROM role_permissions WHERE role_id=?', [role.id]);
    if (meta.permissions.length) {
      const values = meta.permissions
        .map((pk) => permIdByKey.get(pk))
        .filter((id) => id != null)
        .map((pid) => [role.id, pid]);
      if (values.length) {
        await db.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ?', [values]);
      }
    }
  }
};

// Returns true if the column exists. Used to gate the gid → role backfill so we
// can run sync repeatedly even after the legacy column has been dropped.
const columnExists = async (table, column) => {
  const row = await db.one(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [table, column]
  );
  return !!row;
};

// One-time backfill: assign builtin role to existing users based on their gid.
// Idempotent (PRIMARY KEY (uid, role_id) prevents duplicates) and conditional
// on userInfo.gid still existing — once dropped, this is a no-op.
const backfillUserRoles = async () => {
  if (!(await columnExists('userInfo', 'gid'))) return;
  const roleByGid = await db.query('SELECT id, legacy_gid FROM roles WHERE legacy_gid IS NOT NULL');
  for (const r of roleByGid) {
    await db.query(
      `INSERT IGNORE INTO user_roles (uid, role_id, granted_by)
       SELECT uid, ?, NULL FROM userInfo WHERE gid=?`,
      [r.id, r.legacy_gid]
    );
  }
};

// Final retirement of the legacy gid field. After backfill, every gid=2/3 user
// has a moderator/super_admin role row, and the application no longer reads
// gid anywhere. Dropping the column completes the migration so it can't be
// silently relied on again. Set DISABLE_DROP_GID=1 to opt out (e.g., during a
// rollback window where you may want to re-enable old code temporarily).
const dropLegacyGid = async () => {
  if (process.env.DISABLE_DROP_GID === '1') return;
  if (!(await columnExists('userInfo', 'gid'))) return;
  // Only drop after we've confirmed the backfill ran in this process startup.
  console.log('[auth] dropping legacy userInfo.gid column');
  await db.query('ALTER TABLE userInfo DROP COLUMN gid');
};

const syncPermissionCatalog = async () => {
  await ensureSchema();
  await syncPermissions();
  await syncBuiltinRoles();
  await backfillUserRoles();
  await dropLegacyGid();
};

module.exports = { syncPermissionCatalog };
