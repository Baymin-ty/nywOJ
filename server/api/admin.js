const db = require('../db');
const { handler, fail, ok, paginate, buildWhere } = require('../db/util');
const { requirePermission } = require('../auth/middleware');

exports.getUserInfoList = [
  requirePermission('user.list'),
  handler(async (req, res) => {
    const { offset, limit } = paginate(req);
    const filter = req.body.filter || {};

    const cond = [
      ['uid=?', filter.uid],
      ['name LIKE ?', filter.name ? `%${filter.name}%` : null],
      ['email LIKE ?', filter.email ? `%${filter.email}%` : null],
      // 前端 inUse=1 表示封禁(=0)，inUse=2 表示正常(=1)
      ['inUse=?', filter.inUse ? 2 - filter.inUse : null],
    ];

    // Filter by role: filter.roleKey is the role's `key` (e.g. 'moderator').
    let join = '';
    let extraParams = [];
    if (filter.roleKey) {
      join = ' INNER JOIN user_roles ur ON ur.uid = u.uid INNER JOIN roles r ON r.id = ur.role_id AND r.`key`=?';
      extraParams.push(filter.roleKey);
    }
    const { where, params } = buildWhere(cond, 'u.uid > 0');

    const list = await db.query(
      `SELECT u.uid,u.name,u.email,u.inUse FROM userInfo u${join}${where} LIMIT ?,?`,
      [...extraParams, ...params, offset, limit]
    );
    const cnt = await db.one(
      `SELECT COUNT(*) as total FROM userInfo u${join}${where}`,
      [...extraParams, ...params]
    );
    // Attach roles to each row so the admin table can render badges.
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
      for (const r of list) r.roles = byUid.get(r.uid) || [];
    }
    return ok(res, { total: cnt.total, userList: list });
  }),
];

exports.setBlock = [
  requirePermission('user.ban'),
  handler(async (req, res) => {
    const { uid, status } = req.body;
    if (uid == null || status == null) return fail(res, '请确认信息完善');
    const r = await db.query('UPDATE userInfo SET inUse=? WHERE uid=?', [status, uid]);
    if (!r.affectedRows) return fail(res, 'failed');
    return ok(res);
  }),
];

exports.updateUserInfo = [
  requirePermission('user.edit'),
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
