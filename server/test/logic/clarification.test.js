// 赛内提问回归（logic 层）。种一场进行中比赛 + 参赛者 + 管理员，
// 走 提问/私回/公开回复/公告/列表可见性/权限 断言。
//   node test/logic/clarification.test.js
const path = require('path');
process.chdir(path.join(__dirname, '..', '..'));
const db = require('../../db');
const clar = require('../../api/contest/clar');

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ok  ${n}`); };
const ko = (n, m) => { fail++; console.log(`  FAIL ${n} -- ${m}`); };
const assert = (c, n) => (c ? ok(n) : ko(n, 'assertion failed'));
const assertEq = (a, b, n) => (a === b ? ok(n) : ko(n, `expected ${b}, got ${a}`));

const HOST = 965101, PLAYER = 965102, OUTSIDER = 965103, CID = 965200;

// mock req：manager 的 can 全真，其他全假
const mkReq = (uid, isManager) => ({
  body: {},
  session: { uid, ip: '127.0.0.1' },
  useragent: { browser: {}, os: {} },
  can: () => !!isManager,
});
const fakeRes = () => {
  const r = { statusCode: 200, payload: null, status(s) { r.statusCode = s; return r; }, send(p) { r.payload = p; return r; } };
  return r;
};
const call = async (fn, req) => { const res = fakeRes(); await fn(req, res, () => {}); return res; };

const seed = async () => {
  await db.query('INSERT INTO userInfo (uid,name,pwd,reg_time) VALUES (?,?,?,NOW()),(?,?,?,NOW()),(?,?,?,NOW()) ON DUPLICATE KEY UPDATE name=VALUES(name)',
    [HOST, 'clarHost', 'x', PLAYER, 'clarPlayer', 'x', OUTSIDER, 'clarOut', 'x']);
  // 进行中比赛：start 1 小时前，时长 180min，未 done
  const start = new Date(Date.now() - 3600 * 1000);
  await db.query('INSERT INTO contest (cid,title,start,length,host,type,isPublic,done,format,config,phase) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [CID, '[clar] running', start, 180, HOST, 0, 1, 0, 'acm', '{}', 1]);
  await db.query('INSERT INTO contestPlayer (cid,uid) VALUES (?,?)', [CID, PLAYER]);
  await db.query('DELETE FROM notification WHERE uid IN (?)', [[HOST, PLAYER, OUTSIDER]]);
};

const cleanup = async () => {
  await db.query('DELETE FROM contestClar WHERE cid=?', [CID]).catch(() => {});
  await db.query('DELETE FROM contestPlayer WHERE cid=?', [CID]).catch(() => {});
  await db.query('DELETE FROM contest WHERE cid=?', [CID]).catch(() => {});
  await db.query('DELETE FROM notification WHERE uid IN (?)', [[HOST, PLAYER, OUTSIDER]]).catch(() => {});
  await db.query('DELETE FROM userInfo WHERE uid IN (?)', [[HOST, PLAYER, OUTSIDER]]).catch(() => {});
};

const run = async () => {
  await clar.ensureSchema();
  await seed();

  // 参赛者提问
  let req = mkReq(PLAYER, false); req.body = { cid: CID, question: '题目 A 的数据范围是多少？' };
  let res = await call(clar.submitClar, req);
  assertEq(res.statusCode, 200, '参赛者提问成功');
  const clarId = res.payload && res.payload.clarId;
  assert(clarId > 0, '返回 clarId');
  // host 收到新提问通知
  const hostNoti = await db.one("SELECT COUNT(*) AS c FROM notification WHERE uid=? AND type='clar_new'", [HOST]);
  assertEq(hostNoti.c, 1, 'host 收到新提问通知');

  // 非参赛者提问被拒
  req = mkReq(OUTSIDER, false); req.body = { cid: CID, question: 'x' };
  res = await call(clar.submitClar, req);
  assertEq(res.statusCode, 403, '非参赛者提问 403');

  // 管理员私回
  req = mkReq(HOST, true); req.body = { clarId, answer: '数据范围见题面', isPublic: false };
  res = await call(clar.answerClar, req);
  assertEq(res.statusCode, 200, '管理员私回成功');
  const playerNoti = await db.one("SELECT COUNT(*) AS c FROM notification WHERE uid=? AND type='clar_reply'", [PLAYER]);
  assertEq(playerNoti.c, 1, '提问者收到私回通知');

  // 私回后：其他参赛者看不到（isPublic=0）；但这里只有一个 player，测公开可见性用公告
  // 管理员发公告 -> 全体参赛者通知 + 公开可见
  req = mkReq(HOST, true); req.body = { cid: CID, content: '比赛延长 10 分钟' };
  res = await call(clar.postAnnouncement, req);
  assertEq(res.statusCode, 200, '管理员发公告成功');
  const pubNoti = await db.one("SELECT COUNT(*) AS c FROM notification WHERE uid=? AND type='clar_public'", [PLAYER]);
  assertEq(pubNoti.c, 1, '参赛者收到公告通知');

  // 列表：参赛者看到自己的提问 + 公告
  req = mkReq(PLAYER, false); req.body = { cid: CID };
  res = await call(clar.listClars, req);
  assertEq(res.statusCode, 200, '参赛者列表成功');
  const plist = res.payload.data;
  assert(plist.length === 2, '参赛者见 2 条（自己提问 + 公告）');
  assert(!res.payload.isManager, '参赛者非管理视图');

  // 列表：管理员看到全部（含 askerName）
  req = mkReq(HOST, true); req.body = { cid: CID };
  res = await call(clar.listClars, req);
  assert(res.payload.isManager, '管理员管理视图');
  assert(res.payload.data.some((c) => c.askerName === 'clarPlayer'), '管理视图含提问者名');
};

(async () => {
  try { await run(); } catch (e) { ko('unexpected exception', e && e.stack || String(e)); }
  finally { await cleanup(); console.log(`\n${pass} passed, ${fail} failed`); db.pool.end(() => process.exit(fail ? 1 : 0)); }
})();
