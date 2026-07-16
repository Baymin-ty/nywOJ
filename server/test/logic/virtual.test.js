// =============================================================================
// 虚拟参赛（VP）回归（logic 层，只依赖 DB）。
// 核心不变量：官方榜单/最终榜/题目统计永远不被虚拟提交污染（逐字节断言）。
// 另断言：虚拟时钟 policy 推导、合榜视图（ghost + 本人）、封榜掩码按虚拟时钟、
// 会话结算幂等。
//
//   node test/logic/virtual.test.js
// =============================================================================
const path = require('path');
process.chdir(path.join(__dirname, '..', '..'));

const db = require('../../db');
const standings = require('../../api/contest/standings');
const { resolveView } = require('../../api/contest/policy');
const { ensureSchema } = require('../../api/contest/virtualStore');
const { finalizeVirtual } = require('../../api/contest/virtual');

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ok  ${n}`); };
const ko = (n, m) => { fail++; console.log(`  FAIL ${n} -- ${m}`); };
const assert = (c, n) => (c ? ok(n) : ko(n, 'assertion failed'));
const assertEq = (a, b, n) => (a === b ? ok(n) : ko(n, `expected ${b}, got ${a}`));

// ---- 种子工具（高位 id，收尾清除）----
const BASE = 960000;
const seededCids = new Set();
const seededUids = new Set();

const mkUser = async (uid, name) => {
  await db.query(
    'INSERT INTO userInfo (uid, name, pwd, reg_time) VALUES (?,?,?,NOW()) ' +
    'ON DUPLICATE KEY UPDATE name=VALUES(name)',
    [uid, name, 'x']
  );
  seededUids.add(uid);
};

const mkContest = async (cid, format, lengthMin, config, startSecAgo, done = 1) => {
  const start = new Date(Date.now() - startSecAgo * 1000);
  await db.query(
    'INSERT INTO contest (cid,title,start,length,host,type,isPublic,done,format,config,phase) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [cid, `[vp-regress] ${format}`, start, lengthMin, 1, 0, 1, done, format, JSON.stringify(config || {}), 0]
  );
  seededCids.add(cid);
  return start.getTime();
};

const addProblem = (cid, pid, idx, weight) =>
  db.query('INSERT INTO contestProblem (cid,pid,idx,weight) VALUES (?,?,?,?)', [cid, pid, idx, weight]);

const addPlayer = (cid, uid) =>
  db.query('INSERT INTO contestPlayer (cid,uid) VALUES (?,?)', [cid, uid]);

const addSub = async (startMs, cid, uid, pid, result, score, atSec, virtualId = null) => {
  const r = await db.query(
    'INSERT INTO submission (uid,pid,cid,code,submitTime,codeLength,judgeResult,score,time,virtualId) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?)',
    [uid, pid, cid, '//x', new Date(startMs + atSec * 1000), 3, result, score, 10, virtualId]
  );
  return r.insertId;
};

const startVP = async (cid, uid, startSecAgo) => {
  const r = await db.query(
    'INSERT INTO contestVirtual (cid,uid,startAt) VALUES (?,?,?)',
    [cid, uid, new Date(Date.now() - startSecAgo * 1000)]
  );
  const row = await db.one('SELECT vid,cid,uid,startAt,finishedAt FROM contestVirtual WHERE vid=?', [r.insertId]);
  return row;
};

const AC = 4, WA = 6;
const rankOf = (result, key) => result.rank.find((r) => r.key === key);
const mockReq = (uid) => ({ session: { uid }, can: () => false });

const run = async () => {
  await ensureSchema();
  const ghostA = BASE + 1, ghostB = BASE + 2, vpUser = BASE + 3;
  await mkUser(ghostA, 'vpGhostA');
  await mkUser(ghostB, 'vpGhostB');
  await mkUser(vpUser, 'vpRunner');

  // ---------------- OI 历史赛：官方两人 + VP 一人 ----------------
  {
    const cid = BASE + 10;
    const startMs = await mkContest(cid, 'oi', 60, {}, 30 * 24 * 3600); // 30 天前，已 done
    await addProblem(cid, BASE + 101, 1, 100);
    await addProblem(cid, BASE + 102, 2, 100);
    await addPlayer(cid, ghostA);
    await addPlayer(cid, ghostB);
    await addSub(startMs, cid, ghostA, BASE + 101, AC, 100, 600);   // A 10min 过 P1
    await addSub(startMs, cid, ghostB, BASE + 101, WA, 0, 900);
    await addSub(startMs, cid, ghostB, BASE + 102, AC, 100, 1800);  // B 30min 过 P2

    // 官方基线（VP 之前）
    standings.invalidateStandings(cid);
    const before = await standings.computeStandings(cid, { atSec: 3600, masked: false });
    const baseline = JSON.stringify(before.rank);

    // VP 会话：20 分钟前开始，5 分钟时过 P1、15 分钟时过 P2
    const vp = await startVP(cid, vpUser, 1200);
    const vpStartMs = new Date(vp.startAt).getTime();
    const vSid1 = await addSub(vpStartMs, cid, vpUser, BASE + 101, AC, 100, 300, vp.vid);
    await addSub(vpStartMs, cid, vpUser, BASE + 102, AC, 100, 900, vp.vid);

    // 不变量：官方榜逐字节不变（强制重载，走 SQL 隔离而非缓存）
    standings.invalidateStandings(cid);
    const after = await standings.computeStandings(cid, { atSec: 3600, masked: false });
    assertEq(JSON.stringify(after.rank), baseline, '不变量：VP 提交后官方榜逐字节不变');
    assert(!rankOf(after, `u${vpUser}`), '不变量：官方榜无 VP 选手行');

    // 虚拟视图：ghost + 本人合榜，相对秒对齐
    const vres = await standings.computeStandings(cid, { virtual: vp, masked: false });
    const mine = rankOf(vres, `u${vpUser}`);
    assert(mine && mine.virtual === true, 'VP 视图：本人行存在且 virtual 标记');
    assertEq(mine.totalScore, 200, 'VP 视图：本人两题 200 分');
    const gA = rankOf(vres, `u${ghostA}`);
    assert(gA && gA.ghost === true, 'VP 视图：官方选手为 ghost');
    // 虚拟时钟 20 分钟：ghostB 的 30 分钟 AC 还未发生
    const gB = rankOf(vres, `u${ghostB}`);
    assertEq(gB.totalScore, 0, 'VP 视图：ghost 未来事件（30min AC）在 20min 时不可见');
    assert(mine.rank === 1, 'VP 视图：本人 20min 两题排第一');

    // 官方缓存不被虚拟增量污染
    await standings.computeStandings(cid, { atSec: 3600, masked: false }); // 建官方缓存
    await standings.applyEventBySid(vSid1); // 虚拟提交增量 -> 只失效 VP 视图
    const officialAgain = await standings.computeStandings(cid, { atSec: 3600, masked: false });
    assertEq(JSON.stringify(officialAgain.rank), baseline, '增量：虚拟事件不触碰官方缓存');

    // 选手时间线（虚拟视图）
    const tl = await standings.participantTimeline(cid, vpUser, { virtual: vp });
    assert(tl.points.length >= 2 && tl.points[tl.points.length - 1].score === 200, 'VP 时间线：两个拐点、终值 200');

    // policy 虚拟时钟
    const contest = await db.one('SELECT * FROM contest WHERE cid=?', [cid]);
    const view = await resolveView(mockReq(vpUser), contest);
    assert(!!view.virtual, 'policy：活跃 VP 会话命中');
    assertEq(view.status, 1, 'policy：虚拟时钟下状态=进行中');
    assert(view.isReged, 'policy：VP 视作已报名');
    assert(view.caps.canSubmit, 'policy：VP 可提交');
    assert(!view.caps.canHack, 'policy：VP 禁 hack');
    assert(view.caps.scrubSubmissionRow, 'policy：OI VP 进行中遮蔽评测结果');
    const ghostView = await resolveView(mockReq(ghostA), contest);
    assert(!ghostView.virtual && ghostView.status === 3, 'policy：正式选手不受虚拟时钟影响');

    // 终刻成绩卡
    const finalCard = await standings.virtualStandingOf(cid, vp);
    assertEq(finalCard.totalScore, 200, '成绩卡：总分 200');
    assert(finalCard.rank >= 1 && finalCard.playerCount === 3, '成绩卡：合榜名次与人数');

    // 结算幂等
    assertEq(await finalizeVirtual(contest, vp), true, '结算：首次生效');
    assertEq(await finalizeVirtual(contest, vp), false, '结算：重复结算被拒');
    const doneRow = await db.one('SELECT finishedAt FROM contestVirtual WHERE vid=?', [vp.vid]);
    assert(!!doneRow.finishedAt, '结算：finishedAt 落库');
    const expiredView = await resolveView(mockReq(vpUser), contest);
    assert(!expiredView.virtual && expiredView.status === 3, 'policy：结算后回到真实时钟（已结束）');
  }

  // ---------------- ACM + 封榜：掩码按虚拟时钟生效 ----------------
  {
    const cid = BASE + 20;
    const config = { scoreboard: { freeze: { enabled: true, offsetMinutes: 20 } } }; // 40min 起封榜
    const startMs = await mkContest(cid, 'acm', 60, config, 30 * 24 * 3600);
    await addProblem(cid, BASE + 201, 1, 100);
    await addPlayer(cid, ghostA);
    await addSub(startMs, cid, ghostA, BASE + 201, AC, 100, 2700); // ghost 45min AC（封榜期内）

    const vp = await startVP(cid, vpUser, 3000); // 虚拟时钟 50 分钟处
    const masked = await standings.computeStandings(cid, { virtual: vp, masked: true });
    const g = rankOf(masked, `u${ghostA}`);
    assertEq(g.solved, 0, 'ACM 封榜：ghost 封榜期 AC 被掩码（悬念保留）');
    assert(g.detail[1] && g.detail[1].masked === 1, 'ACM 封榜：单元格 masked 计数');
    const unmasked = await standings.computeStandings(cid, { virtual: vp, masked: false });
    assertEq(rankOf(unmasked, `u${ghostA}`).solved, 1, 'ACM 无掩码：ghost AC 可见');
  }

  // ---------------- CF：结算把本会话 pretest 提交转全量 ----------------
  {
    const cid = BASE + 30;
    const startMs = await mkContest(cid, 'cf', 60, {}, 30 * 24 * 3600);
    await addProblem(cid, BASE + 301, 1, 500);
    await addPlayer(cid, ghostA);
    const vp = await startVP(cid, vpUser, 600);
    const vpStartMs = new Date(vp.startAt).getTime();
    // 一发 WA 的 pretest 提交（避免触发重测入队，logic 层无沙箱）
    const sid = await addSub(vpStartMs, cid, vpUser, BASE + 301, WA, 0, 60, vp.vid);
    await db.query("UPDATE submission SET judgeScope='pretest' WHERE sid=?", [sid]);

    const contest = await db.one('SELECT * FROM contest WHERE cid=?', [cid]);
    await finalizeVirtual(contest, vp);
    const row = await db.one('SELECT judgeScope FROM submission WHERE sid=?', [sid]);
    assertEq(row.judgeScope, null, 'CF 结算：本会话提交 judgeScope 清空');
  }
};

const cleanup = async () => {
  const cids = [...seededCids];
  const uids = [...seededUids];
  if (cids.length) {
    await db.query('DELETE FROM submission WHERE cid IN (?)', [cids]).catch(() => {});
    await db.query('DELETE FROM contestProblem WHERE cid IN (?)', [cids]).catch(() => {});
    await db.query('DELETE FROM contestPlayer WHERE cid IN (?)', [cids]).catch(() => {});
    await db.query('DELETE FROM contestVirtual WHERE cid IN (?)', [cids]).catch(() => {});
    await db.query('DELETE FROM contest WHERE cid IN (?)', [cids]).catch(() => {});
  }
  if (uids.length) await db.query('DELETE FROM userInfo WHERE uid IN (?)', [uids]).catch(() => {});
};

(async () => {
  try {
    await run();
  } catch (e) {
    ko('unexpected exception', e && e.stack || String(e));
  } finally {
    await cleanup();
    console.log(`\n${pass} passed, ${fail} failed`);
    db.pool.end(() => process.exit(fail ? 1 : 0));
  }
})();
