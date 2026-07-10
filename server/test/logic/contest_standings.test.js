// =============================================================================
// 榜单事件回放引擎回归（logic 层，只依赖 DB）。
// 为每种赛制种一场比赛（题目/选手/提交），调 computeStandings 断言计分与名次。
// 复刻比赛系统重构 M6 的 47 项回归精神：五赛制计分 / 封榜掩码 / 组队聚合。
//
//   node test/logic/contest_standings.test.js
// =============================================================================
const path = require('path');
process.chdir(path.join(__dirname, '..', '..'));

const db = require('../../db');
const standings = require('../../api/contest/standings');

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ok  ${n}`); };
const ko = (n, m) => { fail++; console.log(`  FAIL ${n} -- ${m}`); };
const assert = (c, n) => (c ? ok(n) : ko(n, 'assertion failed'));
const assertEq = (a, b, n) => (a === b ? ok(n) : ko(n, `expected ${b}, got ${a}`));

// ---- 种子工具（全部用高位 id，收尾统一清除）----
const BASE = 970000;           // uid / cid / pid 基址，避开真实数据
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

// startSecAgo：比赛开始于多少秒前（决定 elapsed；要 > 时长+迟交窗口才能整场回放）
const mkContest = async (cid, format, lengthMin, config, startSecAgo) => {
  const start = new Date(Date.now() - startSecAgo * 1000);
  await db.query(
    'INSERT INTO contest (cid,title,start,length,host,type,isPublic,done,format,config,phase) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [cid, `[regress] ${format}`, start, lengthMin, 1, 0, 1, 0, format, JSON.stringify(config || {}), 3]
  );
  seededCids.add(cid);
  return start.getTime();
};

const addProblem = (cid, pid, idx, weight) =>
  db.query('INSERT INTO contestProblem (cid,pid,idx,weight) VALUES (?,?,?,?)', [cid, pid, idx, weight]);

const addPlayer = (cid, uid, teamId = null) =>
  db.query('INSERT INTO contestPlayer (cid,uid,teamId) VALUES (?,?,?)', [cid, uid, teamId]);

// submitAtSec：相对开赛的秒数 -> submitTime
const addSub = (startMs, cid, uid, pid, result, score, atSec, runTime = 10) =>
  db.query(
    'INSERT INTO submission (uid,pid,cid,code,submitTime,codeLength,judgeResult,score,time) ' +
    'VALUES (?,?,?,?,?,?,?,?,?)',
    [uid, pid, cid, '//x', new Date(startMs + atSec * 1000), 3, result, score, runTime]
  );

const AC = 4, WA = 6;
const rankOf = (result, key) => result.rank.find((r) => r.key === key);

const run = async () => {
  // 需要一个 mkTeam：组队场榜单按队聚合
  const mkTeam = (cid, teamId, name) =>
    db.query(
      'INSERT INTO contestTeam (teamId,cid,name,inviteCode,createTime) VALUES (?,?,?,?,NOW())',
      [teamId, cid, name, `INV${teamId}`]
    );

  await mkUser(BASE + 1, 'regA');
  await mkUser(BASE + 2, 'regB');
  await mkUser(BASE + 3, 'regC');

  // ---------------- OI：每题最后一次提交 × weight ----------------
  {
    const cid = BASE + 10;
    const startMs = await mkContest(cid, 'oi', 60, {}, 7200);
    await addProblem(cid, BASE + 101, 1, 100);
    await addProblem(cid, BASE + 102, 2, 200); // 权重 200 -> 得分翻倍
    await addPlayer(cid, BASE + 1);
    await addPlayer(cid, BASE + 2);
    // A: p1 先 100 后 50（最后一次算 50）；p2 60（×2=120）
    await addSub(startMs, cid, BASE + 1, BASE + 101, AC, 100, 100);
    await addSub(startMs, cid, BASE + 1, BASE + 101, AC, 50, 200);
    await addSub(startMs, cid, BASE + 1, BASE + 102, AC, 60, 300);
    // B: p1 80
    await addSub(startMs, cid, BASE + 2, BASE + 101, AC, 80, 100);
    standings.invalidateStandings(cid);
    const r = await standings.computeStandings(cid, { atSec: 3600, masked: false });
    const a = rankOf(r, `u${BASE + 1}`), b = rankOf(r, `u${BASE + 2}`);
    assertEq(a.detail[1].score, 50, 'oi p1 取最后一次提交(50)');
    assertEq(a.detail[2].score, 120, 'oi p2 加权(60×200/100=120)');
    assertEq(a.totalScore, 170, 'oi A 总分 50+120');
    assertEq(b.totalScore, 80, 'oi B 总分 80');
    assertEq(a.rank, 1, 'oi A 第一');
    assertEq(b.rank, 2, 'oi B 第二');
  }

  // ---------------- IOI：每题历史最高分 ----------------
  {
    const cid = BASE + 20;
    const startMs = await mkContest(cid, 'ioi', 60, {}, 7200);
    await addProblem(cid, BASE + 201, 1, 100);
    await addPlayer(cid, BASE + 1);
    await addSub(startMs, cid, BASE + 1, BASE + 201, AC, 100, 100);
    await addSub(startMs, cid, BASE + 1, BASE + 201, AC, 40, 200); // 后交低分不覆盖
    standings.invalidateStandings(cid);
    const r = await standings.computeStandings(cid, { atSec: 3600, masked: false });
    assertEq(rankOf(r, `u${BASE + 1}`).detail[1].score, 100, 'ioi 取历史最高分(100)');
  }

  // ---------------- ACM：过题数 + 罚时 ----------------
  {
    const cid = BASE + 30;
    const startMs = await mkContest(cid, 'acm', 300, { penalty: { wrongTryMinutes: 20 } }, 36000);
    await addProblem(cid, BASE + 301, 1, 100);
    await addProblem(cid, BASE + 302, 2, 100);
    await addPlayer(cid, BASE + 1);
    await addPlayer(cid, BASE + 2);
    // A: p1 一次错后 600s AC（罚时 600 + 1×1200 = 1800）；p2 300s 直接 AC
    await addSub(startMs, cid, BASE + 1, BASE + 301, WA, 0, 120);
    await addSub(startMs, cid, BASE + 1, BASE + 301, AC, 100, 600);
    await addSub(startMs, cid, BASE + 1, BASE + 302, AC, 100, 300);
    await addSub(startMs, cid, BASE + 1, BASE + 301, AC, 100, 800); // AC 后再交忽略
    // B: 只过 p1，1000s，无错（罚时 1000）
    await addSub(startMs, cid, BASE + 2, BASE + 301, AC, 100, 1000);
    standings.invalidateStandings(cid);
    const r = await standings.computeStandings(cid, { atSec: 300 * 60, masked: false });
    const a = rankOf(r, `u${BASE + 1}`), b = rankOf(r, `u${BASE + 2}`);
    assertEq(a.solved, 2, 'acm A 过 2 题');
    assertEq(a.penalty, 1800 + 300, 'acm A 罚时 p1(600+1200)+p2(300)');
    assertEq(b.solved, 1, 'acm B 过 1 题');
    assertEq(a.rank, 1, 'acm 过题多者第一');
    assert(a.detail[1].firstBlood === true, 'acm A p1 一血');
  }

  // ---------------- ACM 封榜：封榜后事件被掩码 ----------------
  {
    const cid = BASE + 40;
    const startMs = await mkContest(cid, 'acm', 100,
      { scoreboard: { freeze: { enabled: true, offsetMinutes: 20 } } }, 36000);
    await addProblem(cid, BASE + 401, 1, 100);
    await addPlayer(cid, BASE + 1);
    // 时长 100min，封榜起点 = 80min。80min 后 AC 应被掩码。
    await addSub(startMs, cid, BASE + 1, BASE + 401, AC, 100, 90 * 60);
    standings.invalidateStandings(cid);
    const masked = await standings.computeStandings(cid, { atSec: 100 * 60, masked: true });
    const openv = await standings.computeStandings(cid, { atSec: 100 * 60, masked: false });
    assert(masked.frozen === true, 'acm 封榜视图 frozen=true');
    assertEq(rankOf(masked, `u${BASE + 1}`).solved, 0, 'acm 封榜后 AC 被掩码(solved=0)');
    assertEq(rankOf(openv, `u${BASE + 1}`).solved, 1, 'acm 非封榜视图可见 AC(solved=1)');
  }

  // ---------------- CF：初始分线性衰减 ----------------
  {
    const cid = BASE + 50;
    const cfCfg = { cf: { decayPerMinuteRatio: 1 / 250, minRatio: 0.3, wrongPenalty: 50, hackReward: 100, hackFailPenalty: 50 } };
    const startMs = await mkContest(cid, 'cf', 120, cfCfg, 36000);
    await addProblem(cid, BASE + 501, 1, 500); // 初始分 500
    await addPlayer(cid, BASE + 1);
    // 第 10 分钟 AC，无错：500 - 500×(1/250)×10 = 480
    await addSub(startMs, cid, BASE + 1, BASE + 501, AC, 100, 600);
    standings.invalidateStandings(cid);
    const r = await standings.computeStandings(cid, { atSec: 120 * 60, masked: false });
    assertEq(rankOf(r, `u${BASE + 1}`).detail[1].points, 480, 'cf 线性衰减 500->480');
  }

  // ---------------- Homework：迟交折分 + 完成度 ----------------
  {
    const cid = BASE + 60;
    const hwCfg = { late: { enabled: true, windowMinutes: 1440, scoreRatio: 0.5 } };
    const startMs = await mkContest(cid, 'homework', 60, hwCfg, 7200 + 60 * 60); // 时长 60min，已过
    await addProblem(cid, BASE + 601, 1, 100);
    await addProblem(cid, BASE + 602, 2, 100);
    await addPlayer(cid, BASE + 1);
    // p1 按时满分；p2 迟交（第 90 分钟>60）满分 ×0.5=50
    await addSub(startMs, cid, BASE + 1, BASE + 601, AC, 100, 30 * 60);
    await addSub(startMs, cid, BASE + 1, BASE + 602, AC, 100, 90 * 60);
    standings.invalidateStandings(cid);
    const r = await standings.computeStandings(cid, { masked: false });
    const a = rankOf(r, `u${BASE + 1}`);
    assertEq(a.detail[1].score, 100, 'homework 按时满分 100');
    assertEq(a.detail[2].score, 50, 'homework 迟交满分 ×0.5=50');
    assert(a.detail[2].late === true, 'homework p2 标记迟交');
    assertEq(a.solved, 2, 'homework 迟交满分也算完成(solved=2)');
    assertEq(a.totalScore, 150, 'homework 总分 100+50');
  }

  // ---------------- 组队：榜单按队聚合 ----------------
  {
    const cid = BASE + 70;
    const startMs = await mkContest(cid, 'acm', 300, { team: { enabled: true } }, 36000);
    await addProblem(cid, BASE + 701, 1, 100);
    await addProblem(cid, BASE + 702, 2, 100);
    const teamId = BASE + 7001;
    await mkTeam(cid, teamId, 'team-x');
    await addPlayer(cid, BASE + 1, teamId);
    await addPlayer(cid, BASE + 2, teamId);
    // 两名队员各过一题 -> 队伍过 2 题
    await addSub(startMs, cid, BASE + 1, BASE + 701, AC, 100, 200);
    await addSub(startMs, cid, BASE + 2, BASE + 702, AC, 100, 400);
    standings.invalidateStandings(cid);
    const r = await standings.computeStandings(cid, { atSec: 300 * 60, masked: false });
    const t = rankOf(r, `t${teamId}`);
    assert(!!t, '组队榜单出现队伍行');
    if (t) assertEq(t.solved, 2, '组队按队聚合过题数(2)');
  }
};

const cleanup = async () => {
  const cids = [...seededCids];
  const uids = [...seededUids];
  if (cids.length) {
    await db.query('DELETE FROM submission WHERE cid IN (?)', [cids]).catch(() => {});
    await db.query('DELETE FROM contestProblem WHERE cid IN (?)', [cids]).catch(() => {});
    await db.query('DELETE FROM contestPlayer WHERE cid IN (?)', [cids]).catch(() => {});
    await db.query('DELETE FROM contestTeam WHERE cid IN (?)', [cids]).catch(() => {});
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
