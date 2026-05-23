const db = require('../db');
const { handler, fail, ok, paginate, buildWhere } = require('../db/util');
const { requirePermission } = require('../auth/middleware');
const { loadEffectivePermissions, can } = require('../auth/policy');
const { Format, ip2loc, eventList, eventExp } = require('../static');

// 越权防护：仅持有 user.manage 的账号（如 moderator）不能对其他管理员
// （拥有 user.manage 或 user.role.admin 的目标）改密码 / 封禁。拥有
// user.role.admin 的人（super_admin / root）不受此限。返回错误消息或 null。
const guardPrivilegedTarget = async (req, targetUid) => {
  if (req.can('user.role.admin')) return null;
  const targetPerms = await loadEffectivePermissions(targetUid);
  if (can(targetPerms, 'user.manage') || can(targetPerms, 'user.role.admin'))
    return '无权操作该管理员账号';
  return null;
};

// Read-only listing: useful both to user.manage (edit/ban flow) and to
// user.role.admin (role/grant flow), so accept either. Modifying endpoints
// below stay tied to a single permission.
exports.getUserInfoList = [
  requirePermission(['user.manage', 'user.role.admin']),
  handler(async (req, res) => {
    const { offset, limit } = paginate(req);
    const filter = req.body.filter || {};

    // `q` is a unified search box: matches uid (exact) OR name (LIKE) OR email (LIKE).
    // The original separate filters (uid/name/email) are still honored for
    // backwards-compat with the legacy /admin/usermanage page.
    const q = (filter.q || '').trim();
    const cond = [
      ['u.uid=?', filter.uid],
      ['u.name LIKE ?', filter.name ? `%${filter.name}%` : null],
      ['u.email LIKE ?', filter.email ? `%${filter.email}%` : null],
      ['u.inUse=?', filter.inUse != null && filter.inUse !== '' ? Number(filter.inUse) : null],
    ];
    if (q) {
      const isNumeric = /^\d+$/.test(q);
      if (isNumeric) {
        cond.push(['(u.uid=? OR u.name LIKE ? OR u.email LIKE ?)', Number(q), `%${q}%`, `%${q}%`]);
      } else {
        cond.push(['(u.name LIKE ? OR u.email LIKE ?)', `%${q}%`, `%${q}%`]);
      }
    }

    let join = '';
    let extraParams = [];
    if (filter.roleKey) {
      if (filter.roleKey === '__none__') {
        join = ' LEFT JOIN user_roles ur ON ur.uid = u.uid';
        cond.push(['ur.uid IS NULL']);
      } else {
        join = ' INNER JOIN user_roles ur ON ur.uid = u.uid INNER JOIN roles r ON r.id = ur.role_id AND r.`key`=?';
        extraParams.push(filter.roleKey);
      }
    }
    const { where, params } = buildWhere(cond, 'u.uid > 0');

    const sort = req.body.sort || {};
    const allowedSortKeys = { uid: 'u.uid', name: 'u.name', solved: 'solved', lastLogin: 'u.login_time' };
    const sortCol = allowedSortKeys[sort.key] || 'u.uid';
    const sortDir = sort.dir === 'desc' ? 'DESC' : 'ASC';

    const list = await db.query(
      `SELECT u.uid, u.name, u.email, u.inUse, u.reg_time AS regDate, u.login_time AS lastLogin,
              u.motto, u.qq,
              (SELECT COUNT(DISTINCT pid) FROM submission s WHERE s.uid=u.uid AND s.judgeResult=4) AS solved
       FROM userInfo u${join}${where}
       ORDER BY ${sortCol} ${sortDir}
       LIMIT ?,?`,
      [...extraParams, ...params, offset, limit]
    );
    const cnt = await db.one(
      `SELECT COUNT(*) as total FROM userInfo u${join}${where}`,
      [...extraParams, ...params]
    );
    if (list.length) {
      const uids = list.map((r) => r.uid);
      const links = await db.query(
        'SELECT ur.uid, r.`key` AS roleKey FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.uid IN (?)',
        [uids]
      );
      const byUid = new Map();
      for (const l of links) {
        if (!byUid.has(l.uid)) byUid.set(l.uid, []);
        byUid.get(l.uid).push(l.roleKey);
      }
      const grantCounts = await db.query(
        'SELECT uid, COUNT(*) AS cnt FROM user_permissions WHERE uid IN (?) GROUP BY uid',
        [uids]
      );
      const grantMap = new Map();
      for (const g of grantCounts) grantMap.set(g.uid, g.cnt);
      for (const r of list) {
        r.roles = byUid.get(r.uid) || [];
        r.grantCount = grantMap.get(r.uid) || 0;
        if (r.regDate) r.regDate = Format(r.regDate);
        if (r.lastLogin) r.lastLogin = Format(r.lastLogin);
      }
    }
    return ok(res, { total: cnt.total, userList: list });
  }),
];

exports.setBlock = [
  requirePermission('user.manage'),
  handler(async (req, res) => {
    const { uid, status } = req.body;
    if (uid == null || status == null) return fail(res, '请确认信息完善');
    const denied = await guardPrivilegedTarget(req, uid);
    if (denied) return fail(res, denied);
    const r = await db.query('UPDATE userInfo SET inUse=? WHERE uid=?', [status, uid]);
    if (!r.affectedRows) return fail(res, 'failed');
    return ok(res);
  }),
];

exports.updateUserInfo = [
  requirePermission('user.manage'),
  handler(async (req, res) => {
    const info = req.body.info || {};
    const { uid, name, email } = info;
    if (!uid || !name) return fail(res, '请确认信息完善');
    const r = await db.query(
      'UPDATE userInfo SET name=?,email=? WHERE uid=?',
      [name, email, uid]
    );
    if (!r.affectedRows) return fail(res, 'failed');
    return ok(res);
  }),
];

exports.addAnnouncement = [
  requirePermission('announcement.manage'),
  handler(async (req, res) => {
    const r = await db.query(
      'INSERT INTO announcement(title,description,weight,time) VALUES (?,?,?,?)',
      ['请输入公告标题', '请输入公告描述', 10, new Date()]
    );
    if (!r.affectedRows) return fail(res, 'error');
    return ok(res, { aid: r.insertId });
  }),
];

exports.updateAnnouncement = [
  requirePermission('announcement.manage'),
  handler(async (req, res) => {
    const info = req.body.info || {};
    const { aid, title, description, weight } = info;
    const r = await db.query(
      'UPDATE announcement SET title=?,description=?,weight=? WHERE aid=?',
      [title, description, weight, aid]
    );
    if (!r.affectedRows) return fail(res, 'failed');
    return ok(res);
  }),
];

exports.listAuditLog = [
  requirePermission('audit.view'),
  handler(async (req, res) => {
    const { offset, limit } = paginate(req, 20);
    const filter = req.body.filter || {};

    const q = (filter.q || '').trim();
    const qLike = q ? `%${q}%` : null;
    const actorUid = filter.actorUid === '' || filter.actorUid == null ? null : Number(filter.actorUid);
    const eventType = filter.eventType === '' || filter.eventType == null ? null : Number(filter.eventType);
    const startTime = filter.startTime ? new Date(filter.startTime) : null;
    const endTime = filter.endTime ? new Date(filter.endTime) : null;
    const eventIds = q
      ? eventList
        .map((key, id) => ({ id, key, name: eventExp[id] || '' }))
        .filter((e) => e.key.includes(q) || e.name.includes(q))
        .map((e) => e.id)
      : [];
    const qClause = eventIds.length
      ? `(a.event IN (${eventIds.map(() => '?').join(',')}) OR u.name LIKE ? OR a.ip LIKE ? OR a.iploc LIKE ? OR a.browser LIKE ? OR a.os LIKE ? OR a.detail LIKE ?)`
      : '(u.name LIKE ? OR a.ip LIKE ? OR a.iploc LIKE ? OR a.browser LIKE ? OR a.os LIKE ? OR a.detail LIKE ?)';
    const qValues = eventIds.length
      ? [...eventIds, qLike, qLike, qLike, qLike, qLike, qLike]
      : [qLike, qLike, qLike, qLike, qLike, qLike];
    const { where, params } = buildWhere([
      Number.isNaN(actorUid) ? null : ['a.uid=?', actorUid],
      Number.isNaN(eventType) ? null : ['a.event=?', eventType],
      startTime && !Number.isNaN(startTime.getTime()) ? ['a.time>=?', startTime] : null,
      endTime && !Number.isNaN(endTime.getTime()) ? ['a.time<=?', endTime] : null,
      q ? [qClause, ...qValues] : null,
    ]);

    const list = await db.query(
      `SELECT a.uid, u.name AS actorName, a.event, a.ip, a.iploc, a.time, a.browser, a.os, a.detail
       FROM userAudit a LEFT JOIN userInfo u ON u.uid = a.uid${where}
       ORDER BY a.id DESC LIMIT ?,?`,
      [...params, offset, limit]
    );
    const cnt = await db.one(
      `SELECT COUNT(*) AS total FROM userAudit a LEFT JOIN userInfo u ON u.uid = a.uid${where}`,
      params
    );
    for (const r of list) {
      r.eventKey = eventList[r.event] || `event_${r.event}`;
      r.eventName = eventExp[r.event] || r.eventKey;
      if (r.time) r.time = Format(r.time);
      if (r.detail) {
        try { r.detail = JSON.parse(r.detail); } catch (_) {}
      }
    }
    return ok(res, { total: cnt.total, list, eventList, eventExp });
  }),
];

exports.getUserLoginLog = [
  requirePermission(['user.manage', 'user.role.admin']),
  handler(async (req, res) => {
    const uid = parseInt(req.body.uid, 10);
    if (!uid) return fail(res, '请确认信息完善');
    const list = await db.query(
      `SELECT token, browser, os, loginIp, loginLoc, time, lastact
       FROM userSession WHERE uid=? ORDER BY time DESC LIMIT 20`,
      [uid]
    );
    for (const r of list) {
      delete r.token;
      if (r.time) r.time = Format(r.time);
      if (r.lastact) r.lastact = Format(r.lastact);
    }
    return ok(res, { list });
  }),
];

exports.resetPassword = [
  requirePermission('user.manage'),
  handler(async (req, res) => {
    const bcrypt = require('bcryptjs');
    const uid = parseInt(req.body.uid, 10);
    if (!uid) return fail(res, '请确认信息完善');
    const denied = await guardPrivilegedTarget(req, uid);
    if (denied) return fail(res, denied);
    const newPwd = Math.random().toString(36).slice(2, 10);
    const hash = bcrypt.hashSync(newPwd, 12);
    const r = await db.query('UPDATE userInfo SET pwd=? WHERE uid=?', [hash, uid]);
    if (!r.affectedRows) return fail(res, '用户不存在');
    return ok(res, { newPassword: newPwd });
  }),
];

exports.getAdminStats = handler(async (req, res) => {
  if (!req.can('user.manage') && !req.can('user.role.admin'))
    return res.status(403).end('403 Forbidden');
  const [total, withRoles, banned, grantCount] = await Promise.all([
    db.one('SELECT COUNT(*) AS cnt FROM userInfo'),
    db.one('SELECT COUNT(DISTINCT uid) AS cnt FROM user_roles'),
    db.one('SELECT COUNT(*) AS cnt FROM userInfo WHERE inUse=0'),
    db.one('SELECT COUNT(*) AS cnt FROM user_permissions'),
  ]);
  return ok(res, {
    totalUsers: total.cnt,
    withRoles: withRoles.cnt,
    banned: banned.cnt,
    grantCount: grantCount.cnt,
  });
});
