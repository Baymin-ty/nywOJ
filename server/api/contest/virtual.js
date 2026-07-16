const db = require('../../db');
const { handler, fail, ok } = require('../../db/util');
const { getContest, isReg } = require('./store');
const { resolveConfig } = require('./formats');
const { canManageLoaded, loadView } = require('./policy');
const { getVirtual, ensureSchema } = require('./virtualStore');
const { pushSidIntoQueue } = require('../judge/core');
const { invalidateVirtualStandings, virtualStandingOf } = require('./standings');

// ============================================================================
// 虚拟参赛（VP）端点。会话数据在 contestVirtual（virtualStore.js），虚拟时钟
// 在 policy.resolveView（命中活跃会话时 nowMs 平移），榜单合成在 standings.js
// 的 virtual 视图。本文件只管会话生命周期：开始 / 退出 / 状态（含超时懒结算）。
// ============================================================================

// 结束一次 VP 会话（显式退出与超时懒结算共用）。CF 赛制：该会话内 pretest 通过
// 的提交转全量重测（与 startSystest 相同的重置 + 入队方式）。
const finalizeVirtual = async (contest, vp) => {
  const r = await db.query(
    'UPDATE contestVirtual SET finishedAt=NOW() WHERE vid=? AND finishedAt IS NULL',
    [vp.vid]
  );
  if (!r.affectedRows) return false; // 已被并发结算
  const cfg = resolveConfig(contest);
  if (contest.format === 'cf' && cfg.cf && cfg.cf.pretestEnabled) {
    const sids = await db.column(
      'SELECT sid FROM submission WHERE virtualId=? AND judgeResult=4',
      [vp.vid], 'sid'
    );
    await db.query('UPDATE submission SET judgeScope=NULL WHERE virtualId=?', [vp.vid]);
    for (const sid of sids) {
      await db.query(
        'UPDATE submission SET judgeResult=13,time=0,memory=0,score=0,compileResult=NULL,caseResult=NULL WHERE sid=?',
        [sid]
      );
      pushSidIntoQueue(sid, true);
    }
  }
  invalidateVirtualStandings(vp.vid);
  return true;
};

// 超时懒结算：会话超过比赛时长仍未 finished 时补落 finishedAt。
// （getVirtualState / 提交入口都会经过这里，无需定时器。）
const settleIfExpired = async (contest, vp) => {
  if (!vp || vp.finishedAt) return vp;
  const durationMs = contest.length * 60 * 1000;
  if (Date.now() - new Date(vp.startAt).getTime() > durationMs) {
    await finalizeVirtual(contest, vp);
    return { ...vp, finishedAt: new Date() };
  }
  return vp;
};

exports.startVirtual = handler(async (req, res) => {
  const uid = req.session.uid;
  const { cid } = req.body;
  await ensureSchema();
  const v = await loadView(req, cid);
  if (!v) return fail(res, '无此比赛');
  const { contest, cfg } = v;
  if (!v.caps.canEnter) return fail(res, '比赛私有，无法虚拟参赛');
  if (!contest.done) return fail(res, '比赛结束后才能虚拟参赛');
  if (v.isManager) return fail(res, '比赛管理员无需虚拟参赛');
  if (await isReg(uid, cid)) return fail(res, '你已正式参加过本场比赛');
  if (cfg.team && cfg.team.enabled) return fail(res, '组队比赛暂不支持虚拟参赛');

  const existing = await getVirtual(uid, cid);
  if (existing) {
    return fail(res, existing.finishedAt ? '你已虚拟参赛过本场比赛' : '虚拟参赛正在进行中');
  }
  try {
    await db.query('INSERT INTO contestVirtual(cid,uid,startAt) VALUES (?,?,NOW())', [cid, uid]);
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') return fail(res, '虚拟参赛正在进行中');
    throw err;
  }
  return ok(res);
});

exports.quitVirtual = handler(async (req, res) => {
  const uid = req.session.uid;
  const { cid } = req.body;
  await ensureSchema();
  const contest = await getContest(cid);
  if (!contest) return fail(res, '无此比赛');
  const vp = await getVirtual(uid, cid);
  if (!vp || vp.finishedAt) return fail(res, '没有进行中的虚拟参赛');
  await finalizeVirtual(contest, vp);
  return ok(res);
});

// 本人 VP 会话状态。前端据此渲染「虚拟参赛」按钮 / 倒计时横幅 / 赛后成绩卡。
exports.getVirtualState = handler(async (req, res) => {
  const uid = req.session.uid;
  const { cid } = req.body;
  await ensureSchema();
  const contest = await getContest(cid);
  if (!contest) return fail(res, '无此比赛');
  const cfg = resolveConfig(contest);
  const durationSec = contest.length * 60;

  let vp = await getVirtual(uid, cid);
  vp = await settleIfExpired(contest, vp);

  const officialReged = await isReg(uid, cid);
  const isManager = canManageLoaded(req, contest);
  const teamMode = !!(cfg.team && cfg.team.enabled);
  const canStart = !!contest.done && !officialReged && !isManager && !teamMode && !vp;

  const state = {
    canStart,
    // canStart=false 时给前端一个可展示的原因（按钮置灰文案）
    reason: canStart ? null :
      (!contest.done ? '比赛尚未结束'
        : officialReged ? '你已正式参加过本场比赛'
          : isManager ? '比赛管理员无需虚拟参赛'
            : teamMode ? '组队比赛暂不支持虚拟参赛'
              : vp ? null : null),
    active: false,
    finished: false,
    durationSec,
  };
  if (vp) {
    state.vid = vp.vid;
    if (vp.finishedAt) {
      state.finished = true;
      // 终刻合榜成绩（含 ghost 的名次）
      const final = await virtualStandingOf(cid, vp).catch(() => null);
      if (final) {
        state.finalRank = final.rank;
        state.finalScore = final.totalScore;
        state.finalSolved = final.solved;
        state.playerCount = final.playerCount;
      }
    } else {
      const elapsedSec = Math.floor((Date.now() - new Date(vp.startAt).getTime()) / 1000);
      state.active = true;
      state.elapsedSec = elapsedSec;
      state.remainingSec = Math.max(0, durationSec - elapsedSec);
    }
  }
  return ok(res, { data: state });
});

exports.finalizeVirtual = finalizeVirtual;
exports.settleIfExpired = settleIfExpired;
