const db = require('../db');
const { handler, fail, ok, paginate } = require('../db/util');
const { Format, ip2loc } = require('../static');

let dayClick = {};

exports.all = handler(async (req, res) => {
  const list = await db.query(
    'SELECT clickList.id,clickList.time,clickList.uid,userInfo.name,clickList.ip,clickList.iploc,userInfo.clickCnt,userInfo.gid ' +
      'FROM clickList INNER JOIN userInfo ON userInfo.uid = clickList.uid ' +
      'ORDER BY clickList.id DESC LIMIT 20'
  );
  for (const r of list) r.time = Format(r.time);
  return ok(res, { data: list });
});

exports.add = handler(async (req, res) => {
  const { ip, uid } = req.session;

  if (!dayClick.lastClick || new Date().getDate() !== dayClick.lastClick.getDate()) {
    dayClick = {};
  }
  if (!dayClick[uid]) dayClick[uid] = 0;
  if (dayClick[uid] >= 1000000) return fail(res, '请明天再试');

  const iploc = ip2loc(ip);
  const r = await db.query(
    'INSERT INTO clickList(uid,time,ip,iploc) values (?,?,?,?)',
    [uid, new Date(), ip, iploc]
  );
  if (!r.affectedRows) return fail(res, 'error');

  await db.query(
    'INSERT INTO rabbitstat (uid, click, date) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE click = click + 1',
    [uid, new Date()]
  );
  await db.query('UPDATE userInfo SET clickCnt=clickCnt+1 WHERE uid=?', [uid]);

  dayClick[uid]++;
  dayClick.lastClick = new Date();
  return ok(res);
});

exports.getClickCnt = handler(async (req, res) => {
  const uid = req.body.uid || req.session.uid;
  const row = await db.one('SELECT clickCnt FROM userInfo WHERE uid=?', [uid]);
  return ok(res, { clickCnt: row ? row.clickCnt : 0 });
});

exports.getRankInfo = handler(async (req, res) => {
  const { pageId, offset, limit } = paginate(req);
  const list = await db.query(
    'SELECT uid,name,clickCnt,motto,gid,qq FROM userInfo GROUP BY uid ORDER BY clickCnt DESC LIMIT ?,?',
    [offset, limit]
  );
  for (let i = 0; i < list.length; i++) {
    if (String(list[i].motto).length > 50)
      list[i].motto = list[i].motto.substring(0, 50) + '...';
    list[i].rk = offset + i + 1;
    list[i].avatar = list[i].qq
      ? `https://q1.qlogo.cn/g?b=qq&nk=${list[i].qq}&s=3`
      : '/default-avatar.svg';
  }
  const cnt = await db.one('SELECT COUNT(*) as total FROM userInfo');
  return ok(res, { total: cnt.total, data: list });
});

exports.getClickData = handler(async (req, res) => {
  const quid = req.body.uid;
  let day = req.body.day;
  if (typeof day === 'undefined' || day > 100) day = 6;
  else day = day - 1;

  const params = [day];
  let userClause = '';
  if (typeof quid !== 'undefined') {
    userClause = 'AND uid=? ';
    params.push(quid);
  }
  const sql =
    'SELECT date, SUM(click) AS clickCnt, COUNT(DISTINCT uid) AS userCnt ' +
    'FROM rabbitstat ' +
    'WHERE date >= DATE_SUB(CURDATE(), INTERVAL ? DAY) ' +
    userClause +
    'GROUP BY date ORDER BY date';
  const data = await db.query(sql, params);

  const mp = {};
  const now = new Date();
  for (let i = day; i >= 0; i--) {
    mp[Format(new Date(now.getTime() - 1000 * 3600 * 24 * i)).substring(5, 10)] = [0, 0];
  }
  for (const r of data) {
    mp[Format(r.date).substring(5, 10)] = [r.clickCnt, r.userCnt];
  }
  const result = Object.keys(mp).map((date) => ({
    date,
    clickCnt: mp[date][0],
    userCnt: mp[date][1],
  }));
  return ok(res, { data: result });
});
