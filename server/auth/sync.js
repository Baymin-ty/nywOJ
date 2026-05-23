const db = require('../db');
const { PERMISSIONS, BUILTIN_ROLES, LEGACY_GID_ROLE } = require('./permissions');

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
      builtin      TINYINT      NOT NULL DEFAULT 0
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
      `INSERT INTO roles (\`key\`, name, description, builtin)
       VALUES (?,?,?,1)
       ON DUPLICATE KEY UPDATE name=VALUES(name), description=VALUES(description),
                               builtin=1`,
      [key, meta.name, meta.description || null]
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

// Returns true if the column exists. Used to gate the legacy level backfill so
// we can run sync repeatedly even after the legacy column has been dropped.
const columnExists = async (table, column) => {
  const row = await db.one(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [table, column]
  );
  return !!row;
};

// One-time backfill: assign builtin role to existing users based on their
// legacy gid, using the LEGACY_GID_ROLE map (no persisted legacy_gid column).
// Idempotent (PRIMARY KEY (uid, role_id) prevents duplicates) and conditional
// on the old userInfo column still existing — once dropped, this is a no-op.
const backfillUserRoles = async () => {
  if (!(await columnExists('userInfo', 'gid'))) return;
  for (const [gid, roleKey] of Object.entries(LEGACY_GID_ROLE)) {
    const role = await db.one('SELECT id FROM roles WHERE `key`=?', [roleKey]);
    if (!role) continue;
    await db.query(
      `INSERT IGNORE INTO user_roles (uid, role_id, granted_by)
       SELECT uid, ?, NULL FROM userInfo WHERE gid=?`,
      [role.id, Number(gid)]
    );
  }
};

// Final retirement of the old level field. After backfill, elevated legacy
// users have moderator/super_admin role rows, and the application no longer
// reads that column. Dropping it completes the migration so it can't be
// silently relied on again. Set DISABLE_DROP_GID=1 to opt out (e.g., during a
// rollback window where you may want to re-enable old code temporarily).
const dropLegacyGid = async () => {
  if (process.env.DISABLE_DROP_GID === '1') return;
  if (!(await columnExists('userInfo', 'gid'))) return;
  // Only drop after we've confirmed the backfill ran in this process startup.
  console.log('[auth] dropping legacy user level column');
  await db.query('ALTER TABLE userInfo DROP COLUMN gid');
};

// One-shot rename map for permission keys that have been refactored.
// Each entry: oldKey → newKey. Existing user_permissions / role_permissions
// rows pointing at oldKey are repointed at newKey (deduping on the natural
// unique key), and the old permission row is then deleted. Idempotent: if
// the old key has already been removed, it's a no-op.
//
// 2026-05: problem.{edit.any, delete.any, case.manage} all collapse into
// problem.manage.any (scopable). problem.view.private is renamed to
// problem.view.any.
// 2026-05 (later): contest.{edit.any, player.manage} collapse into
// contest.manage.any (scopable). contest_manager role's contest.create
// path now also gets contest.manage.self (the new own-only manage perm).
// 2026-05 (latest): submission.rejudge (scopable) → submission.rejudge.any
// (global only). Scoped grants on the old key become inert global rows after
// rename — contest/problem managers now rejudge automatically through their
// manage.* permissions, so a scoped submission.rejudge no longer has meaning.
const PERMISSION_RENAMES = [
  ['problem.edit.any', 'problem.manage.any'],
  ['problem.delete.any', 'problem.manage.any'],
  ['problem.case.manage', 'problem.manage.any'],
  ['problem.view.private', 'problem.view.any'],
  ['contest.edit.any', 'contest.manage.any'],
  ['contest.player.manage', 'contest.manage.any'],
  ['submission.rejudge', 'submission.rejudge.any'],
  // 2026-05: user admin permissions collapsed into two keys.
  ['user.list', 'user.manage'],
  ['user.edit', 'user.manage'],
  ['user.ban', 'user.manage'],
  ['user.role.assign', 'user.role.admin'],
  ['user.permission.grant', 'user.role.admin'],
  // 2026-05: early draft key for solution binding management.
  ['solution.manage', 'problem.solmanage'],
];

// Permission keys that are deleted outright (no successor). All
// role_permissions / user_permissions rows referencing them are dropped via
// ON DELETE CASCADE when the parent permission row is removed.
//
// 2026-05: contest.submission.view.cross removed. Cross-contest viewing now
// piggybacks on submission.view.any.
const PERMISSION_REMOVALS = [
  'contest.submission.view.cross',
];

const migrateRenamedPermissions = async () => {
  for (const [oldKey, newKey] of PERMISSION_RENAMES) {
    const oldRow = await db.one('SELECT id FROM permissions WHERE `key`=?', [oldKey]);
    if (!oldRow) continue; // already migrated
    const newRow = await db.one('SELECT id FROM permissions WHERE `key`=?', [newKey]);
    if (!newRow) {
      console.warn(`[auth] cannot migrate ${oldKey} → ${newKey}: target key missing`);
      continue;
    }
    console.log(`[auth] migrating ${oldKey} → ${newKey}`);

    // user_permissions: UPDATE IGNORE skips rows that would collide with
    // an existing (uid, permission_id, effect, resource_type, resource_id),
    // then we drop the leftovers.
    await db.query(
      'UPDATE IGNORE user_permissions SET permission_id=? WHERE permission_id=?',
      [newRow.id, oldRow.id]
    );
    await db.query('DELETE FROM user_permissions WHERE permission_id=?', [oldRow.id]);

    // role_permissions: same pattern.
    await db.query(
      'UPDATE IGNORE role_permissions SET permission_id=? WHERE permission_id=?',
      [newRow.id, oldRow.id]
    );
    await db.query('DELETE FROM role_permissions WHERE permission_id=?', [oldRow.id]);

    // Drop the old permission row.
    await db.query('DELETE FROM permissions WHERE id=?', [oldRow.id]);
  }
};

const removeDeletedPermissions = async () => {
  for (const key of PERMISSION_REMOVALS) {
    const row = await db.one('SELECT id FROM permissions WHERE `key`=?', [key]);
    if (!row) continue;
    console.log(`[auth] removing deprecated permission ${key}`);
    // user_permissions / role_permissions cascade-delete via FK ON DELETE CASCADE.
    await db.query('DELETE FROM permissions WHERE id=?', [row.id]);
  }
};

const syncPermissionCatalog = async () => {
  await ensureSchema();
  await syncPermissions();
  // Renames must run AFTER syncPermissions (so the new keys exist) and
  // BEFORE syncBuiltinRoles (which rewrites role_permissions and would
  // otherwise leave stale rows referencing the soon-to-be-deleted old keys).
  await migrateRenamedPermissions();
  await removeDeletedPermissions();
  await syncBuiltinRoles();
  await backfillUserRoles();
  await dropLegacyGid();
};

module.exports = { syncPermissionCatalog };
