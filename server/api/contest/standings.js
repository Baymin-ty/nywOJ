const db = require('../../db');
const { getContest, getContestProblems } = require('./store');
const { resolveConfig } = require('./formats');

// ============================================================================
// 排行榜事件回放引擎。
//
// 事件源 = 该场比赛的全部提交（按提交时刻排序，源头持久在 submission 表），
// 回放到任意时刻 t 即得当时榜单 —— 支持时间轴拖动、封榜掩码（任意赛制可配）、
// 选手分数/排名时间线，天然赛后可用。participantKey 现为 'u<uid>'，M4 组队时
// 切到 't<teamId>'，榜单代码不变。
//
// 每场比赛的事件流缓存在内存（TTL 失效），单次回放对百人/万提交规模为毫秒级。
// ============================================================================

const PENDING_RESULTS = new Set([0, 1, 2]); // Waiting / Pending / Rejudging
const AC_RESULT = 4;
// ICPC 惯例不计罚时的结果：编译错误、取消、跳过、系统故障类
const NO_PENALTY_RESULTS = new Set([3, 12, 13, 14, 16]);

const CACHE_TTL_MS = 10 * 1000;
const cache = new Map(); // cid -> { at, ctx }

const invalidateStandings = (cid) => cache.delete(Number(cid));

// ---- 事件流与上下文 ----

const loadContext = async (cid) => {
  const key = Number(cid);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.ctx;

  const contest = await getContest(cid);
  if (!contest) return null;
  const cfg = resolveConfig(contest);
  const startMs = new Date(contest.start).getTime();
  const durationSec = contest.length * 60;

  const problems = await getContestProblems(cid);
  const playerRows = await db.query(
    `SELECT cp.uid,u.name,u.rating FROM contestPlayer cp
      INNER JOIN userInfo u ON u.uid=cp.uid WHERE cp.cid=?`,
    [cid]
  );
  const submissions = await db.query(
    `SELECT sid,uid,pid,submitTime,judgeResult,score,time
       FROM submission WHERE cid=? ORDER BY submitTime ASC,sid ASC`,
    [cid]
  );

  const pidToIdx = new Map();
  const weights = new Map();
  const problemInfo = {};
  for (const p of problems) {
    pidToIdx.set(Number(p.pid), p.idx);
    weights.set(p.idx, p.weight);
    problemInfo[p.idx] = p.weight;
  }
  const players = new Map(); // uid -> {uid,name,rating}
  for (const u of playerRows) players.set(Number(u.uid), u);

  const events = [];
  for (const s of submissions) {
    const idx = pidToIdx.get(Number(s.pid));
    if (!idx || !players.has(Number(s.uid))) continue;
    events.push({
      sid: s.sid,
      uid: Number(s.uid),
      idx,
      at: Math.max(0, Math.floor((new Date(s.submitTime).getTime() - startMs) / 1000)),
      result: s.judgeResult,
      score: Number(s.score || 0),
      runTime: Number(s.time || 0),
      pending: PENDING_RESULTS.has(s.judgeResult),
    });
  }

  const ctx = { contest, cfg, startMs, durationSec, problemInfo, weights, players, events };
  cache.set(key, { at: Date.now(), ctx });
  return ctx;
};

// ---- 赛制归约器：事件流 -> 每participant每题单元格 + 总量 ----

const newRow = (user) => ({
  key: `u${user.uid}`,
  user: { uid: user.uid, name: user.name, rating: user.rating },
  totalScore: 0,
  usedTime: 0,
  solved: 0,
  penalty: 0,
  detail: {},
  submitted: false,
  rank: 0,
});

// oi: 每题取「最后一次提交」；ioi: 每题取「历史最高分」。
// 单元格 { score(加权), time(运行ms), tries, pending, masked }
const reduceScoreFormats = (ctx, events, { maskAfter, takeMax }) => {
  const rows = new Map();
  for (const u of ctx.players.values()) rows.set(Number(u.uid), newRow(u));

  for (const e of events) {
    const row = rows.get(e.uid);
    if (!row) continue;
    let cell = row.detail[e.idx];
    if (!cell) cell = row.detail[e.idx] = { score: 0, time: 0, tries: 0, pending: 0, masked: 0, rawScore: 0, counted: false };
    if (maskAfter != null && e.at >= maskAfter) { cell.masked++; continue; }
    row.submitted = true;
    cell.tries++;
    if (e.pending) { cell.pending++; continue; }
    const weighted = Math.round((e.score * (ctx.weights.get(e.idx) || 100)) / 100);
    if (takeMax) {
      if (!cell.counted || e.score > cell.rawScore) {
        cell.rawScore = e.score;
        cell.score = weighted;
        cell.time = e.runTime;
        cell.counted = true;
      }
    } else {
      cell.rawScore = e.score;
      cell.score = weighted;
      cell.time = e.runTime;
      cell.counted = true;
    }
  }

  for (const row of rows.values()) {
    for (const idx of Object.keys(row.detail)) {
      const cell = row.detail[idx];
      row.totalScore += cell.score;
      if (cell.rawScore > 0) row.usedTime += cell.time;
    }
  }
  return rows;
};

// acm: 单元格 { ac, time(过题秒), tries(AC前错误数), pending, masked }
const reduceAcm = (ctx, events, { maskAfter }) => {
  const rows = new Map();
  for (const u of ctx.players.values()) rows.set(Number(u.uid), newRow(u));
  const wrongTrySec = (ctx.cfg.penalty && ctx.cfg.penalty.wrongTryMinutes || 20) * 60;

  for (const e of events) {
    const row = rows.get(e.uid);
    if (!row) continue;
    let cell = row.detail[e.idx];
    if (!cell) cell = row.detail[e.idx] = { ac: false, time: 0, tries: 0, pending: 0, masked: 0 };
    if (cell.ac) continue; // AC 后的提交不计
    if (maskAfter != null && e.at >= maskAfter) { cell.masked++; continue; }
    row.submitted = true;
    if (e.pending) { cell.pending++; continue; }
    if (e.result === AC_RESULT) {
      cell.ac = true;
      cell.time = e.at;
      row.solved++;
      row.penalty += e.at + cell.tries * wrongTrySec;
    } else if (!NO_PENALTY_RESULTS.has(e.result)) {
      cell.tries++;
    }
  }
  // ACM 用 totalScore/usedTime 槽承载 solved/penalty，排序复用统一比较器
  for (const row of rows.values()) {
    row.totalScore = row.solved;
    row.usedTime = row.penalty;
  }
  return rows;
};

const comparators = {
  score: (a, b) => {
    if (a.totalScore !== b.totalScore) return b.totalScore - a.totalScore;
    if (a.usedTime !== b.usedTime) return a.usedTime - b.usedTime;
    if (a.submitted !== b.submitted) return b.submitted - a.submitted;
    return a.user.uid - b.user.uid;
  },
  acm: (a, b) => {
    if (a.solved !== b.solved) return b.solved - a.solved;
    if (a.penalty !== b.penalty) return a.penalty - b.penalty;
    if (a.submitted !== b.submitted) return b.submitted - a.submitted;
    return a.user.uid - b.user.uid;
  },
};

const sameStanding = (a, b) =>
  a.totalScore === b.totalScore && a.usedTime === b.usedTime && a.submitted === b.submitted;

const reducerOf = (format) => {
  if (format === 'acm') return { reduce: reduceAcm, compare: comparators.acm };
  if (format === 'ioi') return { reduce: (c, e, o) => reduceScoreFormats(c, e, { ...o, takeMax: true }), compare: comparators.score };
  return { reduce: (c, e, o) => reduceScoreFormats(c, e, { ...o, takeMax: false }), compare: comparators.score };
};

// 一血标记：每题最早 AC（acm）/ 最早满分（oi/ioi）的未掩码提交
const markFirstBlood = (ctx, events, rows, format, maskAfter) => {
  const seen = new Set();
  for (const e of events) {
    if (seen.has(e.idx) || e.pending) continue;
    if (maskAfter != null && e.at >= maskAfter) continue;
    const full = format === 'acm' ? e.result === AC_RESULT : e.score === 100;
    if (!full) continue;
    const row = rows.get(e.uid);
    const cell = row && row.detail[e.idx];
    if (cell && (format === 'acm' ? cell.ac : cell.rawScore === 100)) {
      cell.firstBlood = true;
      seen.add(e.idx);
    }
  }
};

// ---- 对外：任意时刻榜单 ----

// options: { atSec?, masked? } masked=true 时按封榜配置遮蔽封榜期提交
const computeStandings = async (cid, options = {}) => {
  const ctx = await loadContext(cid);
  if (!ctx) return null;
  const format = ctx.contest.format || 'oi';
  const elapsedSec = Math.max(0, Math.floor((Date.now() - ctx.startMs) / 1000));
  const horizon = Math.min(ctx.durationSec, elapsedSec);
  const atSec = options.atSec == null ? horizon : Math.max(0, Math.min(Number(options.atSec), horizon));

  const freeze = ctx.cfg.scoreboard && ctx.cfg.scoreboard.freeze || {};
  const freezeStartSec = freeze.enabled ? Math.max(0, ctx.durationSec - (freeze.offsetMinutes || 0) * 60) : null;
  const maskAfter = options.masked && freezeStartSec != null && atSec >= freezeStartSec ? freezeStartSec : null;

  const visible = ctx.events.filter((e) => e.at <= atSec);
  const { reduce, compare } = reducerOf(format);
  const rows = reduce(ctx, visible, { maskAfter });
  markFirstBlood(ctx, visible, rows, format, maskAfter);

  const rank = [...rows.values()];
  rank.sort(compare);
  let displayedRank = 0;
  const same = format === 'acm'
    ? (a, b) => a.solved === b.solved && a.penalty === b.penalty && a.submitted === b.submitted
    : sameStanding;
  for (let i = 0; i < rank.length; i++) {
    if (i === 0 || !same(rank[i - 1], rank[i])) displayedRank = i + 1;
    rank[i].rank = displayedRank;
  }
  return {
    rank,
    problem: ctx.problemInfo,
    format,
    atSec,
    horizonSec: horizon,
    durationSec: ctx.durationSec,
    frozen: maskAfter != null,
    freezeStartSec,
  };
};

// ---- 选手/队 分数+排名时间线（图表用）----

const participantTimeline = async (cid, uid, options = {}) => {
  const ctx = await loadContext(cid);
  if (!ctx) return null;
  const format = ctx.contest.format || 'oi';
  const target = Number(uid);
  if (!ctx.players.has(target)) return { points: [] };

  const elapsedSec = Math.max(0, Math.floor((Date.now() - ctx.startMs) / 1000));
  let horizon = Math.min(ctx.durationSec, elapsedSec);
  // 封榜遮蔽时，非特权观众的时间线截断在封榜起点
  const freeze = ctx.cfg.scoreboard && ctx.cfg.scoreboard.freeze || {};
  const freezeStartSec = freeze.enabled ? Math.max(0, ctx.durationSec - (freeze.offsetMinutes || 0) * 60) : null;
  if (options.masked && freezeStartSec != null) horizon = Math.min(horizon, freezeStartSec);

  const { reduce, compare } = reducerOf(format);
  const points = [];
  const times = [...new Set(ctx.events.filter((e) => e.at <= horizon && !e.pending).map((e) => e.at))].sort((a, b) => a - b);
  for (const t of times) {
    const visible = ctx.events.filter((e) => e.at <= t);
    const rows = reduce(ctx, visible, { maskAfter: null });
    const rank = [...rows.values()].sort(compare);
    let displayedRank = 0;
    let mine = null;
    const same = format === 'acm'
      ? (a, b) => a.solved === b.solved && a.penalty === b.penalty && a.submitted === b.submitted
      : sameStanding;
    for (let i = 0; i < rank.length; i++) {
      if (i === 0 || !same(rank[i - 1], rank[i])) displayedRank = i + 1;
      if (rank[i].user.uid === target) { mine = { row: rank[i], rank: displayedRank }; break; }
    }
    if (mine) {
      points.push({
        t,
        rank: mine.rank,
        score: format === 'acm' ? mine.row.solved : mine.row.totalScore,
        penalty: format === 'acm' ? mine.row.penalty : undefined,
      });
    }
  }
  return { points, playerCount: ctx.players.size, durationSec: ctx.durationSec, horizonSec: horizon, format };
};

// ---- 最终榜固化（closeContest 时调用）----

const persistFinalStandings = async (cid) => {
  invalidateStandings(cid);
  const result = await computeStandings(cid, { atSec: Number.MAX_SAFE_INTEGER, masked: false });
  if (!result) return 0;
  await db.query('DELETE FROM contestFinalStandings WHERE cid=?', [cid]);
  if (!result.rank.length) return 0;
  const values = result.rank.map((row) => [cid, row.key, row.rank, JSON.stringify(row)]);
  await db.query(
    'INSERT INTO contestFinalStandings (cid,participantKey,rank,payload) VALUES ?',
    [values]
  );
  return result.rank.length;
};

// ---- 兼容层：旧 getRank 的响应形状（oi/ioi 全量、不分页）----

const buildContestRank = async (cid, options = {}) => {
  const result = await computeStandings(cid, options);
  if (!result) return { rank: [], problem: {} };
  return { rank: result.rank, problem: result.problem };
};

module.exports = {
  computeStandings,
  participantTimeline,
  persistFinalStandings,
  buildContestRank,
  invalidateStandings,
};
