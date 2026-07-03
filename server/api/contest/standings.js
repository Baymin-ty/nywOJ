const db = require('../../db');
const { getContestProblems } = require('./store');

// 排行榜计算。M1 为原 buildContestRank 的原样搬移（最后一次提交 × weight，
// usedTime = 有分提交的运行时间之和）；M2 将替换为事件回放引擎
// （任意时刻榜单 / 分页 / 封榜掩码 / participantKey 组队聚合）。

const compareStanding = (a, b) => {
  if (a.totalScore !== b.totalScore) return b.totalScore - a.totalScore;
  if (a.usedTime !== b.usedTime) return a.usedTime - b.usedTime;
  if (a.submitted !== b.submitted) return b.submitted - a.submitted;
  return a.user.uid - b.user.uid;
};

const sameStanding = (a, b) =>
  a.totalScore === b.totalScore &&
  a.usedTime === b.usedTime &&
  a.submitted === b.submitted;

const buildContestRank = async (cid) => {
  const submissions = await db.query(
    `SELECT s.uid,s.pid,s.time,s.score
       FROM contestLastSubmission cls
       INNER JOIN submission s ON s.sid=cls.sid AND s.cid=cls.cid AND s.uid=cls.uid AND s.pid=cls.pid
      WHERE cls.cid=?
      ORDER BY s.time ASC,s.sid ASC`,
    [cid]
  );
  const problems = await getContestProblems(cid);
  const playerUids = await db.column('SELECT uid FROM contestPlayer WHERE cid=?', [cid], 'uid');
  const players = playerUids.length
    ? await db.query('SELECT uid,name,rating FROM userInfo WHERE uid in (?)', [playerUids])
    : [];

  const pidToIdx = new Map();
  const pweight = new Map();
  const pinfo = {};
  for (const p of problems) {
    pidToIdx.set(Number(p.pid), p.idx);
    pweight.set(Number(p.pid), p.weight);
    pinfo[p.idx] = p.weight;
  }

  const uVis = new Set();
  const table = new Map();
  for (const u of players) {
    uVis.add(Number(u.uid));
    table.set(Number(u.uid), {
      user: u,
      totalScore: 0,
      usedTime: 0,
      detail: {},
      submitted: false,
    });
  }

  const acVis = new Set();
  for (const detail of submissions) {
    const uid = Number(detail.uid);
    const pid = Number(detail.pid);
    const idx = pidToIdx.get(pid);
    const row = table.get(uid);
    if (!idx || !uVis.has(uid) || !row) continue;
    const score = Math.round((detail.score * pweight.get(pid)) / 100);
    row.detail[idx] = { score, time: detail.time };
    row.totalScore += score;
    if (detail.score) row.usedTime += detail.time;
    if (detail.score === 100) {
      if (!acVis.has(idx)) row.detail[idx].firstBlood = true;
      acVis.add(idx);
    }
    row.submitted = true;
  }

  const rank = [...table.values()];
  rank.sort(compareStanding);
  let displayedRank = 0;
  for (let i = 0; i < rank.length; i++) {
    if (i === 0 || !sameStanding(rank[i - 1], rank[i])) displayedRank = i + 1;
    rank[i].rank = displayedRank;
  }
  return { rank, problem: pinfo };
};

module.exports = { buildContestRank, compareStanding, sameStanding };
