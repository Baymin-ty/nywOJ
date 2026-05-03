const db = require('../db');
const { handler, fail, ok } = require('../db/util');
const { recordEvent } = require('../static');
const policy = require('../auth/policy');
const { PERMISSIONS, RESOURCE_TYPES, RESOURCE_GRANTABLE } = require('../auth/permissions');
const { buildEndpointMap } = require('../auth/endpoints');

const KEY_REGEX = /^[a-z][a-z0-9_]{0,30}[a-z0-9]$/;

const requireAny = (req, ...keys) => keys.some((k) => req.can(k));

// uid=1 is the root account: bypasses every guard, including the
// "builtin role is read-only" rule. Everything else still goes through
// the normal permission system.
const isRoot = (req) => req.session && req.session.uid === 1;

// ---------- read endpoints ----------

exports.listPermissions = handler(async (req, res) => {
  if (!requireAny(req, 'user.role.assign', 'user.permission.grant'))
    return res.status(403).end('403 Forbidden');
  const rows = await db.query(
    'SELECT `key`, `group`, name, description, scopable FROM permissions ORDER BY `group`, `key`'
  );
  // Attach the API endpoints that enforce each permission, derived from
  // the live express router (see server/auth/endpoints.js).
  const epMap = buildEndpointMap();
  for (const r of rows) r.endpoints = epMap.get(r.key) || [];
  return ok(res, { permissions: rows });
});

exports.listRoles = handler(async (req, res) => {
  if (!requireAny(req, 'user.role.assign', 'user.permission.grant'))
    return res.status(403).end('403 Forbidden');
  const roles = await db.query(
    'SELECT id, `key`, name, description, builtin, legacy_gid FROM roles ORDER BY builtin DESC, id'
  );
  const links = await db.query(
    `SELECT rp.role_id, p.\`key\` AS permission_key
     FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id`
  );
  const byRole = new Map();
  for (const l of links) {
    if (!byRole.has(l.role_id)) byRole.set(l.role_id, []);
    byRole.get(l.role_id).push(l.permission_key);
  }
  for (const r of roles) r.permissions = byRole.get(r.id) || [];
  return ok(res, { roles });
});

// ---------- role management ----------

const setRolePermissions = async (roleId, permKeys) => {
  await db.query('DELETE FROM role_permissions WHERE role_id=?', [roleId]);
  if (!permKeys.length) return;
  const rows = await db.query('SELECT id, `key` FROM permissions WHERE `key` IN (?)', [permKeys]);
  if (rows.length !== permKeys.length) {
    const known = new Set(rows.map((r) => r.key));
    const unknown = permKeys.filter((k) => !known.has(k));
    throw new Error('未知权限: ' + unknown.join(','));
  }
  const values = rows.map((r) => [roleId, r.id]);
  await db.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ?', [values]);
};

exports.createRole = handler(async (req, res) => {
  if (!req.can('user.role.assign')) return res.status(403).end('403 Forbidden');
  const { key, name, description, permissionKeys } = req.body;
  if (!key || !name) return fail(res, '请确认信息完善');
  if (!KEY_REGEX.test(key)) return fail(res, '角色 key 格式非法（小写字母/数字/下划线）');
  const exist = await db.exists('SELECT id FROM roles WHERE `key`=?', [key]);
  if (exist) return fail(res, '该角色 key 已存在');
  const r = await db.query(
    'INSERT INTO roles (`key`, name, description, builtin, legacy_gid) VALUES (?,?,?,0,NULL)',
    [key, name, description || null]
  );
  await setRolePermissions(r.insertId, permissionKeys || []);
  recordEvent(req, 'auth.createRole', { key, name, permissionKeys });
  return ok(res, { id: r.insertId });
});

exports.updateRole = handler(async (req, res) => {
  if (!req.can('user.role.assign')) return res.status(403).end('403 Forbidden');
  const { key, name, description, permissionKeys } = req.body;
  if (!key) return fail(res, '请确认信息完善');
  const role = await db.one('SELECT id, builtin FROM roles WHERE `key`=?', [key]);
  if (!role) return fail(res, '角色不存在');
  if (role.builtin && !isRoot(req)) return fail(res, '内置角色仅 root (uid=1) 可修改');
  if (name != null || description != null) {
    await db.query(
      'UPDATE roles SET name=COALESCE(?,name), description=COALESCE(?,description) WHERE id=?',
      [name || null, description == null ? null : description, role.id]
    );
  }
  if (Array.isArray(permissionKeys)) {
    await setRolePermissions(role.id, permissionKeys);
  }
  // Affected users' caches are wide; broad invalidation is acceptable here.
  policy.invalidate();
  recordEvent(req, 'auth.updateRole', { key, name, permissionKeys });
  return ok(res);
});

exports.deleteRole = handler(async (req, res) => {
  if (!req.can('user.role.assign')) return res.status(403).end('403 Forbidden');
  const { key } = req.body;
  if (!key) return fail(res, '请确认信息完善');
  const role = await db.one('SELECT id, builtin FROM roles WHERE `key`=?', [key]);
  if (!role) return fail(res, '角色不存在');
  if (role.builtin) return fail(res, '内置角色不可删除');
  const inUse = await db.exists('SELECT 1 FROM user_roles WHERE role_id=? LIMIT 1', [role.id]);
  if (inUse) return fail(res, '仍有用户持有此角色，请先解除');
  await db.query('DELETE FROM roles WHERE id=?', [role.id]);
  policy.invalidate();
  recordEvent(req, 'auth.deleteRole', { key });
  return ok(res);
});

// ---------- user grants ----------

exports.listUserGrants = handler(async (req, res) => {
  if (!requireAny(req, 'user.role.assign', 'user.permission.grant'))
    return res.status(403).end('403 Forbidden');
  const uid = parseInt(req.body.uid, 10);
  if (!uid) return fail(res, '请确认信息完善');

  const target = await db.one('SELECT uid, name FROM userInfo WHERE uid=?', [uid]);
  if (!target) return fail(res, '用户不存在');

  const roles = await db.column(
    `SELECT r.\`key\` AS k FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.uid=?`,
    [uid],
    'k'
  );

  const permissions = await db.query(
    `SELECT up.id, p.\`key\` AS permissionKey, up.effect,
            up.resource_type AS resourceType, up.resource_id AS resourceId,
            up.granted_by AS grantedBy, up.granted_at AS grantedAt, up.expires_at AS expiresAt
     FROM user_permissions up JOIN permissions p ON p.id = up.permission_id
     WHERE up.uid=? ORDER BY up.id DESC`,
    [uid]
  );

  return ok(res, { user: target, roles, permissions });
});

exports.setUserRoles = handler(async (req, res) => {
  if (!req.can('user.role.assign')) return res.status(403).end('403 Forbidden');
  const uid = parseInt(req.body.uid, 10);
  const roleKeys = Array.isArray(req.body.roleKeys) ? req.body.roleKeys : null;
  if (!uid || !roleKeys) return fail(res, '请确认信息完善');

  const target = await db.exists('SELECT 1 FROM userInfo WHERE uid=?', [uid]);
  if (!target) return fail(res, '用户不存在');

  let roleRows = [];
  if (roleKeys.length) {
    roleRows = await db.query('SELECT id, `key` FROM roles WHERE `key` IN (?)', [roleKeys]);
    if (roleRows.length !== roleKeys.length) {
      const known = new Set(roleRows.map((r) => r.key));
      const unknown = roleKeys.filter((k) => !known.has(k));
      return fail(res, '未知角色: ' + unknown.join(','));
    }
  }

  await db.tx(async (t) => {
    await t.query('DELETE FROM user_roles WHERE uid=?', [uid]);
    if (roleRows.length) {
      const values = roleRows.map((r) => [uid, r.id, req.session.uid || null]);
      await t.query('INSERT INTO user_roles (uid, role_id, granted_by) VALUES ?', [values]);
    }
  });

  policy.invalidate(uid);
  recordEvent(req, 'auth.setUserRoles', { uid, roleKeys });
  return ok(res);
});

// Resource-owner check: can the current user authorize this scoped grant without holding
// the global user.permission.grant permission?
const canManageResource = async (req, resourceType, resourceId) => {
  if (req.can('user.permission.grant')) return true;
  if (!resourceType || resourceId == null) return false;
  if (resourceType === 'problem') {
    const row = await db.one('SELECT publisher FROM problem WHERE pid=?', [resourceId]);
    if (!row) return false;
    if (row.publisher === req.session.uid) return true;
    return req.can('problem.edit.any', { type: 'problem', id: resourceId });
  }
  if (resourceType === 'contest') {
    const row = await db.one('SELECT host FROM contest WHERE cid=?', [resourceId]);
    if (!row) return false;
    if (row.host === req.session.uid) return true;
    return req.can('contest.edit.any', { type: 'contest', id: resourceId });
  }
  return false;
};

exports.grantUserPermission = handler(async (req, res) => {
  const uid = parseInt(req.body.uid, 10);
  const { permissionKey, effect, resourceType, expiresAt } = req.body;
  const resourceId = req.body.resourceId == null ? null : parseInt(req.body.resourceId, 10);
  if (!uid || !permissionKey || !effect) return fail(res, '请确认信息完善');
  if (effect !== 'allow' && effect !== 'deny') return fail(res, 'effect 只能是 allow 或 deny');

  const isScoped = !!(resourceType && resourceId != null);
  if (resourceType && !RESOURCE_TYPES.includes(resourceType))
    return fail(res, '不支持的资源类型');
  if (!isScoped && (resourceType || resourceId != null))
    return fail(res, 'resourceType 与 resourceId 必须同时提供');

  // Authorization: global grant requires user.permission.grant; scoped grant also accepts
  // resource owner / *.edit.any holders, but only for whitelisted permissions.
  if (isScoped) {
    if (!(await canManageResource(req, resourceType, resourceId)))
      return res.status(403).end('403 Forbidden');
    if (!req.can('user.permission.grant')) {
      const allowed = RESOURCE_GRANTABLE[resourceType] || [];
      if (!allowed.includes(permissionKey))
        return fail(res, '资源所有者不可授予此权限');
      if (effect !== 'allow')
        return fail(res, '资源所有者只能授予允许（allow）权限');
    }
  } else if (!req.can('user.permission.grant')) {
    return res.status(403).end('403 Forbidden');
  }

  const perm = await db.one('SELECT id, scopable FROM permissions WHERE `key`=?', [permissionKey]);
  if (!perm) return fail(res, '未知权限');
  if (isScoped && !perm.scopable) return fail(res, '该权限不支持资源级作用域');

  const target = await db.exists('SELECT 1 FROM userInfo WHERE uid=?', [uid]);
  if (!target) return fail(res, '用户不存在');

  const expires = expiresAt ? new Date(expiresAt) : null;

  // Upsert by UNIQUE KEY (uid, permission_id, effect, resource_type, resource_id).
  await db.query(
    `INSERT INTO user_permissions
       (uid, permission_id, effect, resource_type, resource_id, granted_by, expires_at)
     VALUES (?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       granted_by=VALUES(granted_by), expires_at=VALUES(expires_at), granted_at=CURRENT_TIMESTAMP`,
    [
      uid,
      perm.id,
      effect,
      isScoped ? resourceType : null,
      isScoped ? resourceId : null,
      req.session.uid || null,
      expires,
    ]
  );

  policy.invalidate(uid);
  recordEvent(req, 'auth.grantUserPermission', {
    uid, permissionKey, effect,
    resourceType: isScoped ? resourceType : null,
    resourceId: isScoped ? resourceId : null,
    expiresAt: expires,
  });
  return ok(res);
});

exports.revokeUserPermission = handler(async (req, res) => {
  const id = parseInt(req.body.id, 10);
  if (!id) return fail(res, '请确认信息完善');

  const row = await db.one(
    `SELECT up.uid, up.resource_type AS resourceType, up.resource_id AS resourceId,
            p.\`key\` AS permissionKey
     FROM user_permissions up JOIN permissions p ON p.id = up.permission_id
     WHERE up.id=?`,
    [id]
  );
  if (!row) return fail(res, '记录不存在');

  // Auth: global record requires user.permission.grant; scoped record also accepts owner.
  const isScoped = !!(row.resourceType && row.resourceId != null);
  if (!req.can('user.permission.grant')) {
    if (!isScoped) return res.status(403).end('403 Forbidden');
    if (!(await canManageResource(req, row.resourceType, row.resourceId)))
      return res.status(403).end('403 Forbidden');
  }

  await db.query('DELETE FROM user_permissions WHERE id=?', [id]);
  policy.invalidate(row.uid);
  recordEvent(req, 'auth.revokeUserPermission', { id, ...row });
  return ok(res);
});

exports.listResourceGrants = handler(async (req, res) => {
  const { resourceType } = req.body;
  const resourceId = parseInt(req.body.resourceId, 10);
  if (!resourceType || !resourceId) return fail(res, '请确认信息完善');
  if (!RESOURCE_TYPES.includes(resourceType)) return fail(res, '不支持的资源类型');

  if (!(await canManageResource(req, resourceType, resourceId)))
    return res.status(403).end('403 Forbidden');

  const rows = await db.query(
    `SELECT up.id, up.uid, u.name, p.\`key\` AS permissionKey, up.effect,
            up.expires_at AS expiresAt, up.granted_at AS grantedAt
     FROM user_permissions up
     JOIN permissions p ON p.id = up.permission_id
     JOIN userInfo u ON u.uid = up.uid
     WHERE up.resource_type=? AND up.resource_id=?
     ORDER BY up.id DESC`,
    [resourceType, resourceId]
  );

  const grantable = RESOURCE_GRANTABLE[resourceType] || [];
  return ok(res, { grants: rows, grantablePermissions: grantable });
});

// Helper for the user picker on the management page.
exports.searchUsers = handler(async (req, res) => {
  if (!requireAny(req, 'user.role.assign', 'user.permission.grant'))
    return res.status(403).end('403 Forbidden');
  const q = (req.body.q || '').trim();
  if (!q) return ok(res, { users: [] });
  const isNumeric = /^\d+$/.test(q);
  const rows = await db.query(
    `SELECT uid, name FROM userInfo
     WHERE ${isNumeric ? 'uid=? OR name LIKE ?' : 'name LIKE ?'}
     ORDER BY uid LIMIT 20`,
    isNumeric ? [parseInt(q, 10), `%${q}%`] : [`%${q}%`]
  );
  return ok(res, { users: rows });
});

// Resource pickers for the grant UI: anyone who can grant permissions can
// search problems / contests by id or title.
exports.searchProblems = handler(async (req, res) => {
  if (!req.can('user.permission.grant')) return res.status(403).end('403 Forbidden');
  const q = (req.body.q || '').trim();
  if (!q) return ok(res, { problems: [] });
  const isNumeric = /^\d+$/.test(q);
  const rows = await db.query(
    `SELECT pid, title FROM problem
     WHERE ${isNumeric ? 'pid=? OR title LIKE ?' : 'title LIKE ?'}
     ORDER BY pid DESC LIMIT 20`,
    isNumeric ? [parseInt(q, 10), `%${q}%`] : [`%${q}%`]
  );
  return ok(res, { problems: rows });
});

exports.searchContests = handler(async (req, res) => {
  if (!req.can('user.permission.grant')) return res.status(403).end('403 Forbidden');
  const q = (req.body.q || '').trim();
  if (!q) return ok(res, { contests: [] });
  const isNumeric = /^\d+$/.test(q);
  const rows = await db.query(
    `SELECT cid, title FROM contest
     WHERE ${isNumeric ? 'cid=? OR title LIKE ?' : 'title LIKE ?'}
     ORDER BY cid DESC LIMIT 20`,
    isNumeric ? [parseInt(q, 10), `%${q}%`] : [`%${q}%`]
  );
  return ok(res, { contests: rows });
});

// expose for sanity tests
exports._catalog = { PERMISSIONS };
