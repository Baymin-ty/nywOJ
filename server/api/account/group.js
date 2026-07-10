const db = require('../../db');
const { handler, fail, ok } = require('../../db/util');
const policy = require('../../auth/policy');
const { PERMISSIONS, RESOURCE_TYPES } = require('../../auth/permissions');
const { ensureGroupSchema } = require('../../groupSchema');
const { recordEvent } = require('../../static');
const { ensureContestRatingStorageSchema, latestRatingJoin, effectiveRatingExpr } = require('../contest/ratingStorage');

const GROUP_NAME_MAX = 48;
const GROUP_NAME_REGEX = /^[a-zA-Z0-9 :@~\-_.#$/]{1,48}$/;

const uidOf = (req) => (req.session && req.session.uid) || 0;

const canManageGroups = (req) => !!(req.can && req.can('group.manage'));

const normalizeName = (name) => String(name || '').trim();

const enumError = (res, error, message = error) => ok(res, { error, message });

const boolValue = (value, fallback = false) => {
  if (value == null) return fallback;
  if (typeof value === 'string') return !['0', 'false', 'off', 'no'].includes(value.trim().toLowerCase());
  return !!value;
};

let groupUserMetaSchemaReady = null;
const ensureGroupUserMetaSchema = () => {
  if (!groupUserMetaSchemaReady) {
    groupUserMetaSchemaReady = (async () => {
      const columns = [
        { name: 'nickname', ddl: "VARCHAR(24) NOT NULL DEFAULT ''" },
        { name: 'bio', ddl: "VARCHAR(160) NOT NULL DEFAULT ''" },
        { name: 'avatarInfo', ddl: "VARCHAR(128) NOT NULL DEFAULT ''" },
        { name: 'publicEmail', ddl: 'TINYINT NOT NULL DEFAULT 0' },
      ];
      for (const column of columns) {
        const row = await db.one(
          'SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
          ['userInfo', column.name]
        );
        if (!row || !row.cnt) await db.query(`ALTER TABLE userInfo ADD COLUMN ${column.name} ${column.ddl}`);
      }
      await ensureContestRatingStorageSchema();
    })();
  }
  return groupUserMetaSchemaReady;
};

const validName = (name) => {
  const n = normalizeName(name);
  return n.length >= 1 && n.length <= GROUP_NAME_MAX && GROUP_NAME_REGEX.test(n);
};

const avatarOf = (qq) => (qq ? `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=3` : '/default-avatar.svg');

const userAvatarOf = (row) => {
  const info = String(row && row.avatarInfo || '').trim();
  const pos = info.indexOf(':');
  if (pos > 0) return { type: info.slice(0, pos), key: info.slice(pos + 1) };
  return { type: 'qq', key: row && row.qq ? String(row.qq) : '' };
};

const acceptedCountExpr = (uidSql = 'u.uid') =>
  `(SELECT COUNT(DISTINCT s.pid) FROM submission s WHERE s.uid=${uidSql} AND s.judgeResult=4)`;

const submissionCountExpr = (uidSql = 'u.uid') =>
  `(SELECT COUNT(*) FROM submission s WHERE s.uid=${uidSql})`;

const groupUserMetaSelect = () =>
  `u.uid,u.name,u.email,u.publicEmail,u.qq,u.avatarInfo,u.nickname,u.bio,u.reg_time,` +
  `${effectiveRatingExpr('u')} AS rating,` +
  `${acceptedCountExpr('u.uid')} AS acceptedProblemCount,` +
  `${submissionCountExpr('u.uid')} AS submissionCount`;

const canViewUserEmail = (req, row) =>
  !!(row && row.publicEmail) ||
  Number(row && row.uid) === Number(uidOf(req)) ||
  !!(req.can && (req.can('user.manage') || req.can('user.role.admin')));

const userMetaOf = (req, row) => ({
  id: row.uid,
  uid: row.uid,
  username: row.name,
  name: row.name,
  email: canViewUserEmail(req, row) ? row.email || '' : '',
  nickname: row.nickname || '',
  bio: row.bio || '',
  avatar: userAvatarOf(row),
  isAdmin: Number(row.uid) === 1,
  acceptedProblemCount: Number(row.acceptedProblemCount || 0),
  submissionCount: Number(row.submissionCount || 0),
  rating: Number(row.rating || 0),
  registrationTime: row.reg_time || null,
});

const ensureGroup = async (gid) => {
  const row = await db.one('SELECT gid,name,memberCnt,createTime FROM user_groups WHERE gid=?', [gid]);
  return row || null;
};

const isGroupMember = async (uid, gid) => {
  if (!uid || !gid) return false;
  return db.exists('SELECT 1 FROM group_members WHERE uid=? AND gid=?', [uid, gid]);
};

const isGroupAdmin = async (uid, gid) => {
  if (!uid || !gid) return false;
  return db.exists('SELECT 1 FROM group_members WHERE uid=? AND gid=? AND isAdmin=1', [uid, gid]);
};

const canAdminMembers = async (req, gid) => canManageGroups(req) || (await isGroupAdmin(uidOf(req), gid));

const formatGroupMeta = (row) => ({
  id: row.gid,
  gid: row.gid,
  name: row.name,
  memberCount: row.memberCnt,
  memberCnt: row.memberCnt,
  createTime: row.createTime,
});

const formatGroup = async (req, row) => ({
  ...formatGroupMeta(row),
  isAdmin: canManageGroups(req) || (await isGroupAdmin(uidOf(req), row.gid)),
});

const invalidateGroupAndMembers = async (gid) => {
  await policy.invalidateGroup(gid);
};

exports.getGroupList = handler(async (req, res) => {
  await ensureGroupSchema();
  if (!uidOf(req)) return ok(res, { groups: [], groupsWithAdminPermission: [] });
  let rows;
  if (canManageGroups(req)) {
    rows = await db.query('SELECT gid,name,memberCnt,createTime FROM user_groups ORDER BY gid');
  } else {
    rows = await db.query(
      'SELECT g.gid,g.name,g.memberCnt,g.createTime FROM group_members gm JOIN user_groups g ON g.gid=gm.gid WHERE gm.uid=? ORDER BY g.gid',
      [uidOf(req)]
    );
  }
  const groups = [];
  const groupsWithAdminPermission = [];
  for (const row of rows) {
    const group = await formatGroup(req, row);
    groups.push(group);
    if (group.isAdmin) groupsWithAdminPermission.push(group.gid);
  }
  return ok(res, { groups, groupsWithAdminPermission, canManage: canManageGroups(req) });
});

exports.createGroup = handler(async (req, res) => {
  await ensureGroupSchema();
  if (!canManageGroups(req)) return enumError(res, 'PERMISSION_DENIED', '无权限创建用户组');
  const name = normalizeName(req.body.name || req.body.groupName);
  if (!validName(name)) return fail(res, '组名需为 1 到 48 位，可包含字母、数字、空格和 :@~-_.#$/');
  const dup = await db.exists('SELECT 1 FROM user_groups WHERE name=?', [name]);
  if (dup) return enumError(res, 'DUPLICATE_GROUP_NAME', '该组名已存在');
  const r = await db.query('INSERT INTO user_groups(name,memberCnt,createTime) VALUES (?,?,?)', [name, 0, new Date()]);
  recordEvent(req, 'group.create', { gid: r.insertId, name });
  return ok(res, { groupId: r.insertId, gid: r.insertId });
});

exports.renameGroup = handler(async (req, res) => {
  await ensureGroupSchema();
  if (!canManageGroups(req)) return enumError(res, 'PERMISSION_DENIED', '无权限重命名用户组');
  const gid = parseInt(req.body.gid || req.body.groupId, 10);
  const name = normalizeName(req.body.name);
  if (!gid || !validName(name)) return fail(res, '请确认信息完善');
  const group = await ensureGroup(gid);
  if (!group) return enumError(res, 'NO_SUCH_GROUP', '用户组不存在');
  const dup = await db.exists('SELECT 1 FROM user_groups WHERE name=? AND gid<>?', [name, gid]);
  if (dup) return enumError(res, 'DUPLICATE_GROUP_NAME', '该组名已存在');
  await db.query('UPDATE user_groups SET name=? WHERE gid=?', [name, gid]);
  recordEvent(req, 'group.rename', { gid, oldName: group.name, name });
  return ok(res);
});

exports.deleteGroup = handler(async (req, res) => {
  await ensureGroupSchema();
  if (!canManageGroups(req)) return enumError(res, 'PERMISSION_DENIED', '无权限删除用户组');
  const gid = parseInt(req.body.gid || req.body.groupId, 10);
  if (!gid) return fail(res, '请确认信息完善');
  const group = await ensureGroup(gid);
  if (!group) return enumError(res, 'NO_SUCH_GROUP', '用户组不存在');
  const memberUids = await db.column('SELECT uid FROM group_members WHERE gid=?', [gid], 'uid');
  await db.tx(async (t) => {
    await t.query('DELETE FROM group_permissions WHERE gid=?', [gid]);
    await t.query('DELETE FROM group_members WHERE gid=?', [gid]);
    await t.query('DELETE FROM user_groups WHERE gid=?', [gid]);
  });
  for (const uid of memberUids) policy.invalidate(uid);
  recordEvent(req, 'group.delete', { gid, name: group.name });
  return ok(res);
});

exports.getGroupMemberList = handler(async (req, res) => {
  await ensureGroupSchema();
  await ensureGroupUserMetaSchema();
  const gid = parseInt(req.body.gid || req.body.groupId, 10);
  if (!uidOf(req)) return enumError(res, 'PERMISSION_DENIED', '请先登录');
  if (!gid) return fail(res, '请确认信息完善');
  const group = await ensureGroup(gid);
  if (!group) return enumError(res, 'NO_SUCH_GROUP', '用户组不存在');
  if (!canManageGroups(req) && !(await isGroupMember(uidOf(req), gid))) {
    return enumError(res, 'PERMISSION_DENIED', '无权限查看成员');
  }
  const rows = await db.query(
    `SELECT gm.uid, gm.isAdmin, gm.joinTime, ${groupUserMetaSelect()}
       FROM group_members gm JOIN userInfo u ON u.uid=gm.uid
       ${latestRatingJoin('u')}
      WHERE gm.gid=? ORDER BY gm.isAdmin DESC, gm.uid`,
    [gid]
  );
  const memberList = rows.map((r) => ({
    uid: r.uid,
    name: r.name,
    avatar: avatarOf(r.qq),
    isAdmin: !!r.isAdmin,
    userMeta: userMetaOf(req, r),
    isGroupAdmin: !!r.isAdmin,
    joinTime: r.joinTime,
  }));
  return ok(res, { memberList, canAdmin: await canAdminMembers(req, gid), canManage: canManageGroups(req) });
});

exports.addMember = handler(async (req, res) => {
  await ensureGroupSchema();
  await ensureGroupUserMetaSchema();
  const gid = parseInt(req.body.gid || req.body.groupId, 10);
  const uid = parseInt(req.body.uid || req.body.userId, 10);
  if (!gid || !uid) return fail(res, '请确认信息完善');
  const group = await ensureGroup(gid);
  if (!group) return enumError(res, 'NO_SUCH_GROUP', '用户组不存在');
  if (!(await canAdminMembers(req, gid))) return enumError(res, 'PERMISSION_DENIED', '无权限添加成员');
  const user = await db.one(
    `SELECT ${groupUserMetaSelect()} FROM userInfo u ${latestRatingJoin('u')} WHERE u.uid=?`,
    [uid]
  );
  if (!user) return enumError(res, 'NO_SUCH_USER', '用户不存在');
  const exists = await isGroupMember(uid, gid);
  if (exists) return enumError(res, 'USER_ALREADY_IN_GROUP', '用户已在组内');
  await db.tx(async (t) => {
    await t.query('INSERT INTO group_members(gid,uid,isAdmin,joinTime) VALUES (?,?,0,?)', [gid, uid, new Date()]);
    await t.query('UPDATE user_groups SET memberCnt=memberCnt+1 WHERE gid=?', [gid]);
  });
  policy.invalidate(uid);
  recordEvent(req, 'group.addMember', { gid, uid });
  return ok(res, {
    user: { uid: user.uid, name: user.name, avatar: avatarOf(user.qq), isAdmin: false },
    userMeta: userMetaOf(req, user),
  });
});

exports.removeMember = handler(async (req, res) => {
  await ensureGroupSchema();
  const gid = parseInt(req.body.gid || req.body.groupId, 10);
  const uid = parseInt(req.body.uid || req.body.userId, 10);
  if (!gid || !uid) return fail(res, '请确认信息完善');
  const group = await ensureGroup(gid);
  if (!group) return enumError(res, 'NO_SUCH_GROUP', '用户组不存在');
  if (!(await canAdminMembers(req, gid))) return enumError(res, 'PERMISSION_DENIED', '无权限移除成员');
  const userExists = await db.exists('SELECT 1 FROM userInfo WHERE uid=?', [uid]);
  if (!userExists) return enumError(res, 'NO_SUCH_USER', '用户不存在');
  const member = await db.one('SELECT isAdmin FROM group_members WHERE gid=? AND uid=?', [gid, uid]);
  if (!member) return enumError(res, 'USER_NOT_IN_GROUP', '用户不在组内');
  if (member.isAdmin) return enumError(res, 'GROUP_ADMIN_CAN_NOT_BE_REMOVED', '组管理员不能直接移除，请先取消组管理员');
  await db.tx(async (t) => {
    await t.query('DELETE FROM group_members WHERE gid=? AND uid=?', [gid, uid]);
    await t.query('UPDATE user_groups SET memberCnt=GREATEST(memberCnt-1,0) WHERE gid=?', [gid]);
  });
  policy.invalidate(uid);
  recordEvent(req, 'group.removeMember', { gid, uid });
  return ok(res);
});

exports.setGroupAdmin = handler(async (req, res) => {
  await ensureGroupSchema();
  if (!canManageGroups(req)) return enumError(res, 'PERMISSION_DENIED', '无权限设置组管理员');
  const gid = parseInt(req.body.gid || req.body.groupId, 10);
  const uid = parseInt(req.body.uid || req.body.userId, 10);
  const isAdmin = boolValue(req.body.isAdmin ?? req.body.isGroupAdmin);
  if (!gid || !uid) return fail(res, '请确认信息完善');
  const group = await ensureGroup(gid);
  if (!group) return enumError(res, 'NO_SUCH_GROUP', '用户组不存在');
  const userExists = await db.exists('SELECT 1 FROM userInfo WHERE uid=?', [uid]);
  if (!userExists) return enumError(res, 'NO_SUCH_USER', '用户不存在');
  const member = await db.one('SELECT 1 FROM group_members WHERE gid=? AND uid=?', [gid, uid]);
  if (!member) return enumError(res, 'USER_NOT_IN_GROUP', '用户不在组内');
  await db.query('UPDATE group_members SET isAdmin=? WHERE gid=? AND uid=?', [isAdmin ? 1 : 0, gid, uid]);
  recordEvent(req, isAdmin ? 'group.grantAdmin' : 'group.revokeAdmin', { gid, uid });
  return ok(res);
});

exports.listGroupGrants = handler(async (req, res) => {
  await ensureGroupSchema();
  if (!canManageGroups(req)) return res.status(403).end('403 Forbidden');
  const gid = parseInt(req.body.gid || req.body.groupId, 10);
  if (!gid) return fail(res, '请确认信息完善');
  const group = await ensureGroup(gid);
  if (!group) return fail(res, '用户组不存在');
  const grants = await db.query(
    `SELECT gp.id, gp.gid, p.\`key\` AS permissionKey, gp.effect,
            gp.resource_type AS resourceType, gp.resource_id AS resourceId,
            gp.granted_by AS grantedBy, gp.granted_at AS grantedAt, gp.expires_at AS expiresAt
       FROM group_permissions gp JOIN permissions p ON p.id=gp.permission_id
      WHERE gp.gid=?
        AND (gp.resource_type IS NULL OR gp.resource_type IN (?))
      ORDER BY gp.id DESC`,
    [gid, RESOURCE_TYPES]
  );
  const permissions = Object.entries(PERMISSIONS).map(([key, meta]) => ({
    key,
    group: meta.group,
    name: meta.name,
    description: meta.description || '',
    scopable: !!meta.scopable,
  }));
  return ok(res, { group, grants, permissions, resourceTypes: RESOURCE_TYPES });
});

exports.grantGroupPermission = handler(async (req, res) => {
  await ensureGroupSchema();
  if (!canManageGroups(req)) return res.status(403).end('403 Forbidden');
  const gid = parseInt(req.body.gid || req.body.groupId, 10);
  const { permissionKey, effect, resourceType, expiresAt } = req.body;
  const resourceId = req.body.resourceId == null ? null : parseInt(req.body.resourceId, 10);
  if (!gid || !permissionKey || !effect) return fail(res, '请确认信息完善');
  if (!['allow', 'deny'].includes(effect)) return fail(res, 'effect 只能是 allow 或 deny');
  const isScoped = !!(resourceType && resourceId != null);
  if (resourceType && !RESOURCE_TYPES.includes(resourceType)) return fail(res, '不支持的资源类型');
  if (!isScoped && (resourceType || resourceId != null)) return fail(res, 'resourceType 与 resourceId 必须同时提供');

  const group = await ensureGroup(gid);
  if (!group) return fail(res, '用户组不存在');
  const perm = await db.one('SELECT id, scopable FROM permissions WHERE `key`=?', [permissionKey]);
  if (!perm) return fail(res, '未知权限');
  if (isScoped && !perm.scopable) return fail(res, '该权限不支持资源级作用域');
  const expires = expiresAt ? new Date(expiresAt) : null;
  if (isScoped) {
    await db.query(
      'DELETE FROM group_permissions WHERE gid=? AND permission_id=? AND effect=? AND resource_type=? AND resource_id=?',
      [gid, perm.id, effect, resourceType, resourceId]
    );
  } else {
    await db.query(
      'DELETE FROM group_permissions WHERE gid=? AND permission_id=? AND effect=? AND resource_type IS NULL AND resource_id IS NULL',
      [gid, perm.id, effect]
    );
  }
  await db.query(
    `INSERT INTO group_permissions
       (gid, permission_id, effect, resource_type, resource_id, granted_by, expires_at)
     VALUES (?,?,?,?,?,?,?)`,
    [gid, perm.id, effect, isScoped ? resourceType : null, isScoped ? resourceId : null, uidOf(req) || null, expires]
  );
  await invalidateGroupAndMembers(gid);
  recordEvent(req, 'group.grantPermission', { gid, permissionKey, effect, resourceType, resourceId, expiresAt: expires });
  return ok(res);
});

exports.revokeGroupPermission = handler(async (req, res) => {
  await ensureGroupSchema();
  if (!canManageGroups(req)) return res.status(403).end('403 Forbidden');
  const id = parseInt(req.body.id, 10);
  if (!id) return fail(res, '请确认信息完善');
  const row = await db.one('SELECT gid FROM group_permissions WHERE id=?', [id]);
  if (!row) return fail(res, '记录不存在');
  await db.query('DELETE FROM group_permissions WHERE id=?', [id]);
  await invalidateGroupAndMembers(row.gid);
  recordEvent(req, 'group.revokePermission', { id, gid: row.gid });
  return ok(res);
});
