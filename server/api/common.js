const { randomInt } = require('crypto');
const db = require('../db');
const { handler, fail, ok, paginate, buildWhere } = require('../db/util');
const { briefFormat, Format } = require('../static');

const getMark = () => {
  const time = Date.now().toString(36);
  const str = Math.random().toString(36).slice(2, 7);
  return `${time}-${str}`;
};

exports.getAnnouncementList = handler(async (req, res) => {
  const rows = await db.query('SELECT aid,time,title FROM announcement ORDER BY weight DESC LIMIT 5');
  for (const r of rows) r.time = briefFormat(r.time);
  return ok(res, { data: rows });
});

exports.getAnnouncementInfo = handler(async (req, res) => {
  const row = await db.one('SELECT * FROM announcement WHERE aid=?', [req.body.aid]);
  if (!row) return fail(res, 'error');
  row.time = briefFormat(row.time);
  return ok(res, { data: row });
});

exports.getPaste = handler(async (req, res) => {
  const row = await db.one(
    'SELECT title,mark,content,uid,time,isPublic FROM pastes WHERE mark=?',
    [req.body.mark]
  );
  if (!row) return fail(res, '未找到');
  if (req.session.gid < 3 && !row.isPublic && row.uid !== req.session.uid) {
    return fail(res, '无权限查看');
  }
  row.time = Format(row.time);
  const author = await db.one('SELECT name FROM userInfo WHERE uid=?', [row.uid]);
  row.paster = author ? author.name : null;
  return ok(res, { data: row });
});

exports.addPaste = handler(async (req, res) => {
  const mark = getMark();
  const result = await db.query(
    'INSERT INTO pastes(mark,title,content,uid,time,isPublic) VALUES (?,?,?,?,?,?)',
    [mark, '请输入标题', '请输入内容', req.session.uid, new Date(), 0]
  );
  if (!result.affectedRows) return fail(res, 'error');
  return ok(res, { mark });
});

exports.updatePaste = handler(async (req, res) => {
  const { paste } = req.body;
  const { content, title } = paste;
  if (title.length > 20) return fail(res, '标题长度不可大于20');
  if (paste.length > 10000) return fail(res, '内容长度不可大于10000');

  const owner = await db.one('SELECT uid FROM pastes WHERE mark=?', [paste.mark]);
  if (!owner) return fail(res, '未找到');
  if (req.session.gid < 3 && req.session.uid !== owner.uid) {
    return fail(res, '你只能修改自己的paste');
  }

  const result = await db.query(
    'UPDATE pastes SET title=?,content=?,isPublic=?,time=? WHERE mark=?',
    [title, content, paste.isPublic, new Date(), paste.mark]
  );
  if (!result.affectedRows) return fail(res, 'failed');
  return ok(res);
});

exports.delPaste = handler(async (req, res) => {
  const { mark } = req.body;
  const owner = await db.one('SELECT uid FROM pastes WHERE mark=?', [mark]);
  if (!owner) return fail(res, '未找到');
  if (req.session.gid < 3 && req.session.uid !== owner.uid) {
    return fail(res, '你只能删除自己的paste');
  }
  const result = await db.query('DELETE FROM pastes WHERE mark=?', [mark]);
  if (!result.affectedRows) return fail(res, 'failed');
  return ok(res);
});

exports.getPasteList = handler(async (req, res) => {
  const { offset, limit } = paginate(req);
  let uid = req.body.uid || null;
  if (req.session.gid < 3) uid = req.session.uid;

  const cond = [['p.uid=?', uid]];
  const { where, params } = buildWhere(cond);

  const list = await db.query(
    'SELECT p.id,p.mark,p.title,p.uid,p.time,p.isPublic,u.name as publisher ' +
      'FROM pastes p INNER JOIN userInfo u ON u.uid = p.uid' +
      `${where} ORDER BY p.id DESC LIMIT ?,?`,
    [...params, offset, limit]
  );
  for (const r of list) r.time = Format(r.time);

  const cntRow = await db.one(
    `SELECT COUNT(*) as total FROM pastes p${where}`,
    params
  );
  return ok(res, { total: cntRow.total, data: list });
});

const hitokoto = require('../hitokoto/hitokoto.json');
const hitokotoLen = hitokoto.length;

exports.getHitokoto = (req, res) => {
  return res.status(200).send(hitokoto[randomInt(hitokotoLen)]);
};
