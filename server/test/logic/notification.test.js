// 站内通知 push/查询/幂等 回归（logic 层）。
//   node test/logic/notification.test.js
const path = require('path');
process.chdir(path.join(__dirname, '..', '..'));
const db = require('../../db');
const noti = require('../../api/content/notification');

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ok  ${n}`); };
const ko = (n, m) => { fail++; console.log(`  FAIL ${n} -- ${m}`); };
const assertEq = (a, b, n) => (a === b ? ok(n) : ko(n, `expected ${b}, got ${a}`));

const U1 = 966001, U2 = 966002;

const run = async () => {
  await noti.ensureSchema();
  await db.query('DELETE FROM notification WHERE uid IN (?)', [[U1, U2]]);

  // push 基础 + excludeUid
  const n1 = await noti.push([U1, U2], { type: 'x', title: 't1', excludeUid: U2 });
  assertEq(n1, 1, 'push 排除触发者(U2)后只发 U1');

  // 幂等：同 dedupeKey 两次只落一条
  await noti.push(U1, { type: 'x', title: 't2', dedupeKey: 'k1' });
  const dup = await noti.push(U1, { type: 'x', title: 't2 again', dedupeKey: 'k1' });
  assertEq(dup, 0, 'dedupeKey 撞键第二次 0 行');
  const cntK1 = await db.one("SELECT COUNT(*) AS c FROM notification WHERE uid=? AND dedupeKey='k1'", [U1]);
  assertEq(cntK1.c, 1, 'dedupeKey 只有一条');

  // 未读数
  const unread = await db.one('SELECT COUNT(*) AS c FROM notification WHERE uid=? AND isRead=0', [U1]);
  assertEq(unread.c, 2, 'U1 未读 2 条(t1 + k1)');

  // markRead 单条
  const rows = await db.query('SELECT nid FROM notification WHERE uid=? ORDER BY nid', [U1]);
  await db.query('UPDATE notification SET isRead=1 WHERE uid=? AND nid IN (?)', [U1, [rows[0].nid]]);
  const unread2 = await db.one('SELECT COUNT(*) AS c FROM notification WHERE uid=? AND isRead=0', [U1]);
  assertEq(unread2.c, 1, 'markRead 后未读 1 条');

  // push 空/无效不落
  const z = await noti.push([], { type: 'x', title: 'z' });
  assertEq(z, 0, '空 uid 列表 0 行');
  const z2 = await noti.push(U1, { title: 'no type' });
  assertEq(z2, 0, '缺 type 0 行');
};

const cleanup = () => db.query('DELETE FROM notification WHERE uid IN (?)', [[U1, U2]]).catch(() => {});

(async () => {
  try { await run(); } catch (e) { ko('unexpected exception', e && e.stack || String(e)); }
  finally { await cleanup(); console.log(`\n${pass} passed, ${fail} failed`); db.pool.end(() => process.exit(fail ? 1 : 0)); }
})();
