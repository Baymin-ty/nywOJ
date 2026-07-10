const db = require('../../db');
const { handler, fail, ok } = require('../../db/util');
const { recordEvent } = require('../../static');
const policy = require('../../auth/policy');
const { PERMISSIONS, RESOURCE_TYPES, RESOURCE_GRANTABLE } = require('../../auth/permissions');
const { syncPermissionCatalog } = require('../../auth/sync');
const { buildEndpointMap } = require('../../auth/endpoints');

const KEY_REGEX = /^[a-z][a-z0-9_]{0,30}[a-z0-9]$/;

const requireAny = (req, ...keys) => keys.some((k) => req.can(k));

// uid=1 is the root account: bypasses every guard, including the
// "builtin role is read-only" rule. Everything else still goes through
// the normal permission system.
const isRoot = (req) => req.session && Number(req.session.uid) === 1;

// ---------- read endpoints ----------

exports.listPermissions = handler(async (req, res) => {
  if (!requireAny(req, 'user.role.admin', 'user.manage', 'group.manage'))
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
  if (!requireAny(req, 'user.role.admin', 'user.manage'))
    return res.status(403).end('403 Forbidden');
  const roles = await db.query(
    'SELECT id, `key`, name, description, builtin FROM roles ORDER BY builtin DESC, id'
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

exports.syncCatalog = handler(async (req, res) => {
  if (!req.can('user.role.admin')) return res.status(403).end('403 Forbidden');
  await syncPermissionCatalog();
  policy.invalidate();
  const [permissionCount, roleCount] = await Promise.all([
    db.one('SELECT COUNT(*) AS cnt FROM permissions'),
    db.one('SELECT COUNT(*) AS cnt FROM roles'),
  ]);
  return ok(res, {
    permissionCount: Number(permissionCount && permissionCount.cnt || 0),
    roleCount: Number(roleCount && roleCount.cnt || 0),
  });
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
  if (!isRoot(req)) return res.status(403).end('403 Forbidden');
  const { key, name, description, permissionKeys } = req.body;
  if (!key || !name) return fail(res, '请确认信息完善');
  if (!KEY_REGEX.test(key)) return fail(res, '角色 key 格式非法（小写字母/数字/下划线）');
  const exist = await db.exists('SELECT id FROM roles WHERE `key`=?', [key]);
  if (exist) return fail(res, '该角色 key 已存在');
  const r = await db.query(
    'INSERT INTO roles (`key`, name, description, builtin) VALUES (?,?,?,0)',
    [key, name, description || null]
  );
  await setRolePermissions(r.insertId, permissionKeys || []);
  recordEvent(req, 'auth.createRole', { key, name, permissionKeys });
  return ok(res, { id: r.insertId });
});

exports.updateRole = handler(async (req, res) => {
  if (!isRoot(req)) return res.status(403).end('403 Forbidden');
  const { key, name, description, permissionKeys } = req.body;
  if (!key) return fail(res, '请确认信息完善');
  const role = await db.one('SELECT id, builtin FROM roles WHERE `key`=?', [key]);
  if (!role) return fail(res, '角色不存在');
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
  if (!isRoot(req)) return res.status(403).end('403 Forbidden');
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
  if (!requireAny(req, 'user.role.admin', 'user.manage'))
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
     WHERE up.uid=?
       AND (up.resource_type IS NULL OR up.resource_type IN (?))
     ORDER BY up.id DESC`,
    [uid, RESOURCE_TYPES]
  );

  return ok(res, { user: target, roles, permissions });
});

exports.setUserRoles = handler(async (req, res) => {
  if (!req.can('user.role.admin')) return res.status(403).end('403 Forbidden');
  const uid = parseInt(req.body.uid, 10);
  const roleKeys = Array.isArray(req.body.roleKeys) ? req.body.roleKeys : null;
  if (!uid || !roleKeys) return fail(res, '请确认信息完善');
  // uid=1 在 policy 中被硬编码为 root；允许剥夺它的角色只会让 UI 显示成「无角色」而不影响实权，反而让审计混乱。
  if (uid === 1) return fail(res, '不可修改根账号角色');

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

// 批量设置角色。mode 决定语义：
//   'set'    — 覆盖：每个用户的角色被替换为 roleKeys；
//   'add'    — 追加：在各自现有角色基础上并入 roleKeys；
//   'remove' — 移除：从各自现有角色中去掉 roleKeys。
// uid=1 在 policy 中硬编码为 root，始终跳过。每个被改动的用户都单独写一条
// auth.setUserRoles 审计，使审计日志与单用户编辑保持一致。
exports.setUserRolesBatch = handler(async (req, res) => {
  if (!req.can('user.role.admin')) return res.status(403).end('403 Forbidden');
  const mode = req.body.mode;
  if (!['set', 'add', 'remove'].includes(mode)) return fail(res, '未知操作模式');
  const roleKeys = Array.isArray(req.body.roleKeys) ? [...new Set(req.body.roleKeys)] : null;
  const uids = Array.isArray(req.body.uids)
    ? [...new Set(req.body.uids.map((x) => parseInt(x, 10)).filter((x) => x > 0 && x !== 1))]
    : [];
  // 'set' 允许空 roleKeys（即清空角色）；add/remove 必须指定至少一个角色。
  if (!uids.length || !roleKeys || (mode !== 'set' && !roleKeys.length))
    return fail(res, '请确认信息完善');

  let roleRows = [];
  if (roleKeys.length) {
    roleRows = await db.query('SELECT id, `key` FROM roles WHERE `key` IN (?)', [roleKeys]);
    if (roleRows.length !== roleKeys.length) {
      const known = new Set(roleRows.map((r) => r.key));
      return fail(res, '未知角色: ' + roleKeys.filter((k) => !known.has(k)).join(','));
    }
  }
  const selectedIds = roleRows.map((r) => r.id);

  const validUids = await db.column('SELECT uid FROM userInfo WHERE uid IN (?)', [uids], 'uid');
  if (!validUids.length) return fail(res, '没有可操作的用户');

  // 现有角色映射：uid -> Set(roleId)
  const current = new Map(validUids.map((u) => [u, new Set()]));
  const links = await db.query('SELECT uid, role_id FROM user_roles WHERE uid IN (?)', [validUids]);
  for (const l of links) current.get(l.uid).add(l.role_id);

  const grantedBy = req.session.uid || null;
  await db.tx(async (t) => {
    for (const uid of validUids) {
      let finalIds;
      if (mode === 'set') {
        finalIds = new Set(selectedIds);
      } else if (mode === 'add') {
        finalIds = new Set(current.get(uid));
        selectedIds.forEach((id) => finalIds.add(id));
      } else {
        finalIds = new Set(current.get(uid));
        selectedIds.forEach((id) => finalIds.delete(id));
      }
      // 与现状一致则跳过写库。
      const cur = current.get(uid);
      if (finalIds.size === cur.size && [...finalIds].every((id) => cur.has(id))) continue;
      await t.query('DELETE FROM user_roles WHERE uid=?', [uid]);
      if (finalIds.size) {
        const values = [...finalIds].map((id) => [uid, id, grantedBy]);
        await t.query('INSERT INTO user_roles (uid, role_id, granted_by) VALUES ?', [values]);
      }
    }
  });

  // 失效缓存 + 逐用户审计（写库后做，避免事务回滚后仍记录）。审计里记录本次
  // 施加的操作（mode + 涉及的角色），而非重算的最终集合，避免丢失用户原有角色信息。
  for (const uid of validUids) {
    policy.invalidate(uid);
    recordEvent(req, 'auth.setUserRoles', { uid, roleKeys, batch: mode });
  }

  return ok(res, { success: validUids.length, skipped: uids.length - validUids.length });
});

// Two distinct checks for resource-scoped permission grants:
//
// 1. canViewResourceCollab — can list current collaborators (read-only).
//    Owners + collaborators (anyone with manage.any scoped) + global grantors.
//
// 2. canManageResourceCollab — can ADD or REMOVE collaborators on a resource.
//    Only owners + global grantors. A collaborator who got manage.any scoped
//    to one problem/contest is NOT empowered to grant new collaborators —
//    that's the "协作者拥有manage的权利但不具有修改协作者的权利" rule.
const fetchOwner = async (resourceType, resourceId) => {
  if (resourceType === 'problem') {
    const row = await db.one('SELECT publisher AS ownerUid FROM problem WHERE pid=?', [resourceId]);
    return row ? row.ownerUid : null;
  }
  if (resourceType === 'contest') {
    const row = await db.one('SELECT host AS ownerUid FROM contest WHERE cid=?', [resourceId]);
    return row ? row.ownerUid : null;
  }
  return null;
};

const canManageResourceCollab = async (req, resourceType, resourceId) => {
  if (!resourceType || resourceId == null) return false;
  const owner = await fetchOwner(resourceType, resourceId);
  if (owner == null) return false;
  if (req.can('user.role.admin')) return true;
  return owner === req.session.uid;
};

const canViewResourceCollab = async (req, resourceType, resourceId) => {
  if (await canManageResourceCollab(req, resourceType, resourceId)) return true;
  // Collaborators (manage.any scoped) can also see the collaborator list.
  if (resourceType === 'problem')
    return req.can('problem.manage.any', { type: 'problem', id: resourceId });
  if (resourceType === 'contest')
    return req.can('contest.manage.any', { type: 'contest', id: resourceId });
  return false;
};

const scopedResourceIds = (req, permissionKeys, resourceType) => {
  const ids = new Set();
  const prefix = `${resourceType}:`;
  for (const key of permissionKeys) {
    const bucket = req.perms?.scoped?.get(key);
    if (!bucket) continue;
    for (const tag of bucket) {
      if (!tag.startsWith(prefix)) continue;
      const id = Number(tag.slice(prefix.length));
      if (Number.isSafeInteger(id) && id > 0) ids.add(id);
    }
  }
  return [...ids];
};

const buildProblemSearchVisibility = (req) => {
  if (req.can('user.role.admin') || req.can('problem.view.any') || req.can('problem.manage.any')) {
    return { sql: '1=1', params: [] };
  }
  const parts = ['isPublic=1'];
  const params = [];
  if (req.session.uid) {
    parts.push('publisher=?');
    params.push(req.session.uid);
  }
  const scopedPids = scopedResourceIds(req, ['problem.manage.any', 'problem.view.any'], 'problem');
  if (scopedPids.length) {
    parts.push(`pid IN (${scopedPids.map(() => '?').join(',')})`);
    params.push(...scopedPids);
  }
  return { sql: `(${parts.join(' OR ')})`, params };
};

const buildContestSearchVisibility = (req) => {
  if (req.can('user.role.admin') || req.can('contest.manage.any')) {
    return { sql: '1=1', params: [] };
  }
  const parts = ['isPublic=1'];
  const params = [];
  if (req.session.uid) {
    parts.push('host=?');
    params.push(req.session.uid);
    parts.push('cid IN (SELECT cpv.cid FROM contestPlayer cpv WHERE cpv.uid=?)');
    params.push(req.session.uid);
  }
  const scopedCids = scopedResourceIds(req, ['contest.manage.any'], 'contest');
  if (scopedCids.length) {
    parts.push(`cid IN (${scopedCids.map(() => '?').join(',')})`);
    params.push(...scopedCids);
  }
  return { sql: `(${parts.join(' OR ')})`, params };
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

  // Authorization: global grant requires user.permission.grant; scoped grant
  // also accepts the resource OWNER (not collaborators), but only for
  // whitelisted permissions. Collaborators-can-grant was deliberately removed
  // — see canManageResourceCollab.
  if (isScoped) {
    if (!(await canManageResourceCollab(req, resourceType, resourceId)))
      return res.status(403).end('403 Forbidden');
    if (!req.can('user.role.admin')) {
      const allowed = RESOURCE_GRANTABLE[resourceType] || [];
      if (!allowed.includes(permissionKey))
        return fail(res, '资源所有者不可授予此权限');
      if (effect !== 'allow')
        return fail(res, '资源所有者只能授予允许（allow）权限');
    }
  } else if (!req.can('user.role.admin')) {
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

  // Auth: global record requires user.permission.grant; scoped record also
  // accepts owner (collaborators with manage.any can NOT revoke other
  // collaborators — only the owner manages the collaborator list).
  const isScoped = !!(row.resourceType && row.resourceId != null);
  if (!req.can('user.role.admin')) {
    if (!isScoped) return res.status(403).end('403 Forbidden');
    if (!(await canManageResourceCollab(req, row.resourceType, row.resourceId)))
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

  if (!(await canViewResourceCollab(req, resourceType, resourceId)))
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
  const keys = new Set(grantable);
  for (const r of rows) keys.add(r.permissionKey);
  const permissions = Array.from(keys).map((key) => {
    const p = PERMISSIONS[key];
    return p
      ? { key, group: p.group, name: p.name, description: p.description, scopable: !!p.scopable }
      : { key, group: 'other', name: key, description: '', scopable: false };
  });
  return ok(res, { grants: rows, grantablePermissions: grantable, permissions });
});

// Helper for the user picker on the admin page AND on resource collaborator
// pickers (problem owner / contest host adding collaborators). Returns only
// uid + name, both already public via /user/:uid, so the privacy bar is low.
// Any logged-in user may use it — uid+name is already exposed on profile pages.
exports.searchUsers = handler(async (req, res) => {
  if (!req.session.uid) return res.status(403).end('403 Forbidden');
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

// Resource pickers for the grant UI. Role admins can search globally; owners,
// registered users and scoped collaborators only see resources already visible
// to them, so private titles do not become searchable side channels.
exports.searchProblems = handler(async (req, res) => {
  if (!req.session.uid) return res.status(403).end('403 Forbidden');
  const q = (req.body.q || '').trim();
  if (!q) return ok(res, { problems: [] });
  const visibility = buildProblemSearchVisibility(req);
  const isNumeric = /^\d+$/.test(q);
  const rows = await db.query(
    `SELECT pid, title FROM problem
     WHERE ${visibility.sql} AND ${isNumeric ? '(pid=? OR title LIKE ?)' : 'title LIKE ?'}
     ORDER BY pid DESC LIMIT 20`,
    [...visibility.params, ...(isNumeric ? [parseInt(q, 10), `%${q}%`] : [`%${q}%`])]
  );
  return ok(res, { problems: rows });
});

exports.searchContests = handler(async (req, res) => {
  if (!req.session.uid) return res.status(403).end('403 Forbidden');
  const q = (req.body.q || '').trim();
  if (!q) return ok(res, { contests: [] });
  const visibility = buildContestSearchVisibility(req);
  const isNumeric = /^\d+$/.test(q);
  const rows = await db.query(
    `SELECT cid, title FROM contest
     WHERE ${visibility.sql} AND ${isNumeric ? '(cid=? OR title LIKE ?)' : 'title LIKE ?'}
     ORDER BY cid DESC LIMIT 20`,
    [...visibility.params, ...(isNumeric ? [parseInt(q, 10), `%${q}%`] : [`%${q}%`])]
  );
  return ok(res, { contests: rows });
});
