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
  const teamMode = !!(cfg.team && cfg.team.enabled);
  const playerRows = await db.query(
    `SELECT cp.uid,cp.teamId,u.name,u.rating FROM contestPlayer cp
      INNER JOIN userInfo u ON u.uid=cp.uid WHERE cp.cid=?`,
    [cid]
  );
  const submissions = await db.query(
    `SELECT sid,uid,pid,submitTime,judgeResult,score,time
       FROM submission WHERE cid=? ORDER BY submitTime ASC,sid ASC`,
    [cid]
  );
  // 已判定的 hack（CF）：成功的 hack 让目标提交在 hack 时刻起视为失败；
  // hacker 按成败得/扣分。judgedTime 换算为相对秒。
  const hackRows = contest.format === 'cf' ? await db.query(
    `SELECT hackId,pid,hackerUid,targetSid,status,judgedTime
       FROM contestHack WHERE cid=? AND status IN ('success','fail') AND judgedTime IS NOT NULL
      ORDER BY judgedTime ASC,hackId ASC`,
    [cid]
  ).catch(() => []) : [];

  const pidToIdx = new Map();
  const weights = new Map();
  const problemInfo = {};
  for (const p of problems) {
    pidToIdx.set(Number(p.pid), p.idx);
    weights.set(p.idx, p.weight);
    problemInfo[p.idx] = p.weight;
  }

  // participant 抽象：个人模式 key='u<uid>'，组队模式 key='t<teamId>'。
  // uidToKey 把每条提交/hack 的作者映射到参赛主体，榜单代码对两种模式一致。
  const participants = new Map(); // key -> { key, uid, name, rating, teamId, members }
  const uidToKey = new Map();
  if (teamMode) {
    const teamRows = await db.query('SELECT teamId,name FROM contestTeam WHERE cid=?', [cid]);
    const teamInfo = new Map(teamRows.map((t) => [Number(t.teamId), t.name]));
    const memberMap = new Map(); // teamId -> [{uid,name}]
    for (const u of playerRows) {
      if (!u.teamId) continue;
      const tid = Number(u.teamId);
      uidToKey.set(Number(u.uid), `t${tid}`);
      if (!memberMap.has(tid)) memberMap.set(tid, []);
      memberMap.get(tid).push({ uid: Number(u.uid), name: u.name });
    }
    for (const [tid, name] of teamInfo) {
      participants.set(`t${tid}`, {
        key: `t${tid}`, uid: tid, name, rating: 0, teamId: tid,
        members: memberMap.get(tid) || [],
      });
    }
  } else {
    for (const u of playerRows) {
      const key = `u${u.uid}`;
      uidToKey.set(Number(u.uid), key);
      participants.set(key, { key, uid: Number(u.uid), name: u.name, rating: u.rating, teamId: null, members: null });
    }
  }

  const events = [];
  for (const s of submissions) {
    const idx = pidToIdx.get(Number(s.pid));
    const key = uidToKey.get(Number(s.uid));
    if (!idx || !key) continue;
    events.push({
      sid: s.sid,
      key,
      idx,
      at: Math.max(0, Math.floor((new Date(s.submitTime).getTime() - startMs) / 1000)),
      result: s.judgeResult,
      score: Number(s.score || 0),
      runTime: Number(s.time || 0),
      pending: PENDING_RESULTS.has(s.judgeResult),
    });
  }

  const hacks = [];
  for (const h of hackRows) {
    hacks.push({
      hackId: h.hackId,
      hackerKey: uidToKey.get(Number(h.hackerUid)) || null,
      targetSid: Number(h.targetSid),
      idx: pidToIdx.get(Number(h.pid)),
      success: h.status === 'success',
      at: Math.max(0, Math.floor((new Date(h.judgedTime).getTime() - startMs) / 1000)),
    });
  }

  const ctx = { contest, cfg, startMs, durationSec, problemInfo, weights, participants, events, hacks };
  cache.set(key, { at: Date.now(), ctx });
  return ctx;
};

// ---- 赛制归约器：事件流 -> 每participant每题单元格 + 总量 ----

const newRow = (p) => ({
  key: p.key,
  user: { uid: p.uid, name: p.name, rating: p.rating },
  members: p.members,
  teamId: p.teamId,
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
  for (const p of ctx.participants.values()) rows.set(p.key, newRow(p));

  for (const e of events) {
    const row = rows.get(e.key);
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
  for (const p of ctx.participants.values()) rows.set(p.key, newRow(p));
  const wrongTrySec = (ctx.cfg.penalty && ctx.cfg.penalty.wrongTryMinutes || 20) * 60;

  for (const e of events) {
    const row = rows.get(e.key);
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

// cf: 得分 = max(初始分×minRatio, 初始分 − 初始分×decay×过题分钟 − wrongPenalty×先前错误)
// 被成功 hack 的 AC 从 hack 时刻起视为一次错误（可重新提交翻盘）；hacker ±hack 分。
// 单元格 { ac, points, time(过题秒), tries, pending, masked, hacked }
const reduceCf = (ctx, events, { maskAfter, tLimit }) => {
  const rows = new Map();
  for (const p of ctx.participants.values()) rows.set(p.key, newRow(p));
  const cf = ctx.cfg.cf || {};
  const decay = Number(cf.decayPerMinuteRatio) || 0;
  const minRatio = Number(cf.minRatio) || 0;
  const wrongPenalty = Number(cf.wrongPenalty) || 0;
  const horizon = tLimit == null ? Infinity : tLimit;

  // 成功 hack（已生效、未被掩码）：targetSid -> hack 相对秒
  const hackedAt = new Map();
  for (const h of ctx.hacks) {
    if (!h.success || h.at > horizon) continue;
    if (maskAfter != null && h.at >= maskAfter) continue;
    if (!hackedAt.has(h.targetSid)) hackedAt.set(h.targetSid, h.at);
  }

  for (const e of events) {
    const row = rows.get(e.key);
    if (!row) continue;
    let cell = row.detail[e.idx];
    if (!cell) cell = row.detail[e.idx] = { ac: false, points: 0, time: 0, tries: 0, pending: 0, masked: 0, hacked: false };
    if (cell.ac) continue; // 过题后（未被 hack）的提交忽略
    if (maskAfter != null && e.at >= maskAfter) { cell.masked++; continue; }
    row.submitted = true;
    if (e.pending) { cell.pending++; continue; }
    if (e.result === AC_RESULT) {
      const hackTime = hackedAt.get(e.sid);
      if (hackTime != null) {
        // 被 hack：该次 AC 视为一次错误尝试（自 hack 时刻起）
        cell.tries++;
        cell.hacked = true;
      } else {
        cell.ac = true;
        cell.time = e.at;
        cell.hacked = false;
      }
    } else if (!NO_PENALTY_RESULTS.has(e.result)) {
      cell.tries++;
    }
  }

  for (const row of rows.values()) {
    for (const idx of Object.keys(row.detail)) {
      const cell = row.detail[idx];
      if (!cell.ac) continue;
      const init = Number(ctx.weights.get(Number(idx)) || 0);
      const minutes = Math.floor(cell.time / 60);
      const raw = init - init * decay * minutes - wrongPenalty * cell.tries;
      cell.points = Math.max(Math.round(init * minRatio), Math.round(raw));
      row.totalScore += cell.points;
      row.solved++;
    }
    // hacker 得分
    let hackScore = 0, hackOk = 0, hackFail = 0;
    for (const h of ctx.hacks) {
      if (h.hackerKey !== row.key || h.at > horizon) continue;
      if (maskAfter != null && h.at >= maskAfter) continue;
      if (h.success) { hackScore += Number(cf.hackReward) || 0; hackOk++; }
      else { hackScore -= Number(cf.hackFailPenalty) || 0; hackFail++; }
    }
    row.hackScore = hackScore;
    row.hackOk = hackOk;
    row.hackFail = hackFail;
    row.totalScore += hackScore;
    if (hackOk || hackFail) row.submitted = true;
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
  cf: (a, b) => {
    if (a.totalScore !== b.totalScore) return b.totalScore - a.totalScore;
    if (a.submitted !== b.submitted) return b.submitted - a.submitted;
    return a.user.uid - b.user.uid;
  },
};

const sameStanding = (a, b) =>
  a.totalScore === b.totalScore && a.usedTime === b.usedTime && a.submitted === b.submitted;

const sameOf = (format) => {
  if (format === 'acm') return (a, b) => a.solved === b.solved && a.penalty === b.penalty && a.submitted === b.submitted;
  if (format === 'cf') return (a, b) => a.totalScore === b.totalScore && a.submitted === b.submitted;
  return sameStanding;
};

const reducerOf = (format) => {
  if (format === 'acm') return { reduce: reduceAcm, compare: comparators.acm };
  if (format === 'cf') return { reduce: reduceCf, compare: comparators.cf };
  if (format === 'ioi') return { reduce: (c, e, o) => reduceScoreFormats(c, e, { ...o, takeMax: true }), compare: comparators.score };
  return { reduce: (c, e, o) => reduceScoreFormats(c, e, { ...o, takeMax: false }), compare: comparators.score };
};

// 一血标记：每题最早 AC（acm）/ 最早满分（oi/ioi）的未掩码提交
const markFirstBlood = (ctx, events, rows, format, maskAfter) => {
  const acBased = format === 'acm' || format === 'cf';
  const seen = new Set();
  for (const e of events) {
    if (seen.has(e.idx) || e.pending) continue;
    if (maskAfter != null && e.at >= maskAfter) continue;
    const full = acBased ? e.result === AC_RESULT : e.score === 100;
    if (!full) continue;
    const row = rows.get(e.key);
    const cell = row && row.detail[e.idx];
    if (cell && (acBased ? cell.ac : cell.rawScore === 100)) {
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
  const rows = reduce(ctx, visible, { maskAfter, tLimit: atSec });
  markFirstBlood(ctx, visible, rows, format, maskAfter);

  const rank = [...rows.values()];
  rank.sort(compare);
  let displayedRank = 0;
  const same = sameOf(format);
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

// participant 可传 participantKey（'u<uid>'/'t<teamId>'）或裸 uid（个人模式向后兼容）
const participantTimeline = async (cid, participant, options = {}) => {
  const ctx = await loadContext(cid);
  if (!ctx) return null;
  const format = ctx.contest.format || 'oi';
  const targetKey = /^[ut]\d+$/.test(String(participant)) ? String(participant) : `u${Number(participant)}`;
  if (!ctx.participants.has(targetKey)) return { points: [] };

  const elapsedSec = Math.max(0, Math.floor((Date.now() - ctx.startMs) / 1000));
  let horizon = Math.min(ctx.durationSec, elapsedSec);
  // 封榜遮蔽时，非特权观众的时间线截断在封榜起点
  const freeze = ctx.cfg.scoreboard && ctx.cfg.scoreboard.freeze || {};
  const freezeStartSec = freeze.enabled ? Math.max(0, ctx.durationSec - (freeze.offsetMinutes || 0) * 60) : null;
  if (options.masked && freezeStartSec != null) horizon = Math.min(horizon, freezeStartSec);

  const { reduce, compare } = reducerOf(format);
  const points = [];
  const sampleTimes = ctx.events.filter((e) => e.at <= horizon && !e.pending).map((e) => e.at)
    .concat(ctx.hacks.filter((h) => h.at <= horizon).map((h) => h.at));
  const times = [...new Set(sampleTimes)].sort((a, b) => a - b);
  const same = sameOf(format);
  for (const t of times) {
    const visible = ctx.events.filter((e) => e.at <= t);
    const rows = reduce(ctx, visible, { maskAfter: null, tLimit: t });
    const rank = [...rows.values()].sort(compare);
    let displayedRank = 0;
    let mine = null;
    for (let i = 0; i < rank.length; i++) {
      if (i === 0 || !same(rank[i - 1], rank[i])) displayedRank = i + 1;
      if (rank[i].key === targetKey) { mine = { row: rank[i], rank: displayedRank }; break; }
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
  return { points, playerCount: ctx.participants.size, durationSec: ctx.durationSec, horizonSec: horizon, format };
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
