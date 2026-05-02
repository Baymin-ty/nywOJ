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
      ['gid=?', filter.gid],
      // 前端 inUse=1 表示封禁(=0)，inUse=2 表示正常(=1)
      ['inUse=?', filter.inUse ? 2 - filter.inUse : null],
    ];
    const { where, params } = buildWhere(cond, 'uid > 0');

    const list = await db.query(
      `SELECT uid,name,email,gid,inUse FROM userInfo${where} LIMIT ?,?`,
      [...params, offset, limit]
    );
    const cnt = await db.one(`SELECT COUNT(*) as total FROM userInfo${where}`, params);
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
    const { uid, name, email, gid } = info;
    if (!uid || !name || !gid) return fail(res, '请确认信息完善');
    const r = await db.query(
      'UPDATE userInfo SET name=?,email=?,gid=? WHERE uid=?',
      [name, email, gid, uid]
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
