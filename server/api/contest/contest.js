const db = require('../../db');
const { handler, fail, ok, paginate } = require('../../db/util');
const { requirePermission } = require('../../auth/middleware');
const { Format, briefFormat, kbFormat } = require('../../static');
const { judgeRes, formatSubmissionRow, formatCaseRow, cstatus } = require('../../db/format');
const { pushSidIntoQueue, streamSubmission } = require('../judge/core');
const { getProblemLang, problemAuth, loadProblemSamples } = require('../problem/core');
const { readJudgeLogEntries } = require('../judge/log');
const { summarizeProfileFlow: summarizeJudgeProfile } = require('../problem/judgeProfile');
const { ensureContestV2Schema } = require('./schema');
const {
  getContest, isReg, playerCnt, getProblemByIdx, getIdxByPid, contestListVisibility,
} = require('./store');
const {
  contestStatus, canManageContest, resolveView, loadView,
} = require('./policy');
const {
  normalizeFormat, formatLabel, resolveConfig, validateConfigPatch, legacyTypeOf,
} = require('./formats');
const {
  buildContestRank, computeStandings, participantTimeline,
  persistFinalStandings, invalidateStandings, invalidateVirtualStandings,
} = require('./standings');
const { ensureSchema: ensureVirtualSchema } = require('./virtualStore');
const { deepMerge } = require('./formats');
const {
  ensureContestRatingSchema,
  attachContestRatingStatus,
  contestRatingStatusForContest,
  ratingStatusResponseMeta,
  ratingRowsForContest,
  applyContestRating,
  ratingWriteResultPayload,
} = require('./rating');

// ============================================================================
// 比赛本体端点（薄层）。鉴权/可见性一律通过 policy.js 的 caps，计分通过
// standings.js，Rating 端点在 rating.js，赛制配置在 formats.js。
// ============================================================================

const ptype = ['传统文本比较', 'Special Judge'];

const EDITABLE_FORMATS = ['oi', 'ioi', 'acm', 'cf', 'homework'];

exports.canManageContest = canManageContest;

// 提交行遮蔽：OI 式比赛未结束时非管理员看不到结果（分数/结果/时间/内存清零）。
// CF 赛制 pretest 范围的 AC 显示为 "Pretests Passed"（终测/重测后 scope 清空恢复）。
const formatContestSubmissionRow = async (r, ctx) => {
  r.idx = await getIdxByPid(ctx.cid, r.pid);
  r.pid = null;
  r.submitTime = Format(r.submitTime);
  if (ctx.caps.scrubSubmissionRow) {
    r.score = r.judgeResult = r.time = r.memory = 0;
  }
  const pretestPassed = ctx.format === 'cf' && r.judgeScope === 'pretest' && r.judgeResult === 4;
  r.judgeResult = pretestPassed ? 'Pretests Passed' : judgeRes[r.judgeResult];
  r.memory = kbFormat(r.memory);
  return r;
};

// ---- 基本信息 ----

exports.createContest = [
  requirePermission('contest.create'),
  handler(async (req, res) => {
    await ensureContestV2Schema();
    // format 可选（作业列表页传 'homework'），缺省 oi
    const format = EDITABLE_FORMATS.includes(req.body.format) ? req.body.format : 'oi';
    const title = format === 'homework' ? '请输入作业标题' : '请输入比赛标题';
    const r = await db.query(
      'INSERT INTO contest(title,host,start,length,type,isPublic,format) VALUES (?,?,?,?,?,?,?)',
      [title, req.session.uid, new Date(2121, 10, 22), 180, legacyTypeOf(format), 0, format]
    );
    if (!r.affectedRows) return fail(res, 'error');
    return ok(res, { cid: r.insertId });
  }),
];

exports.updateContestInfo = [
  handler(async (req, res) => {
    await ensureContestV2Schema();
    await ensureContestRatingSchema();
    const { cid, info } = req.body;
    const contest = await getContest(cid);
    if (!contest) return fail(res, '无此比赛');
    if (!(await canManageContest(req, cid)))
      return fail(res, '你只能修改自己的比赛');
    if (contest.done) return fail(res, '比赛已经结束');
    if (!info.title || !info.start || !info.length || (!info.type && !info.format))
      return fail(res, '请确认信息完善');
    if (info.title.length > 30) return fail(res, '比赛名称最长30个字符');

    // 赛制：新前端传 format；旧前端传 type ('OI'/'IOI')
    let format;
    if (info.format !== undefined) {
      format = info.format;
    } else {
      format = { OI: 'oi', IOI: 'ioi' }[info.type];
    }
    if (!EDITABLE_FORMATS.includes(format)) return fail(res, '非法比赛类型');

    if (info.isPublic !== true && info.isPublic !== false) return fail(res, '非法isPublic参数');
    // 作业强制 unrated（结算侧 rating.js 也有兜底）
    const ratingEnabled = format === 'homework'
      ? false
      : (info.ratingEnabled === undefined ? !!contest.ratingEnabled : !!info.ratingEnabled);

    // 配置覆盖（partial patch，null = 清空回 preset 默认）
    let configJson = contest.config;
    if (info.config !== undefined) {
      if (info.config === null) configJson = null;
      else {
        const errors = validateConfigPatch(format, info.config);
        if (errors.length) return fail(res, `配置有误：${errors[0]}`);
        configJson = JSON.stringify(info.config);
      }
    }

    const r = await db.query(
      'UPDATE contest SET title=?,description=?,start=?,length=?,type=?,isPublic=?,lang=?,ratingEnabled=?,format=?,config=? WHERE cid=?',
      [info.title, info.description, new Date(info.start), info.length, legacyTypeOf(format),
        info.isPublic, info.lang, ratingEnabled ? 1 : 0, format, configJson, cid]
    );
    if (!r.affectedRows) return fail(res, 'error');
    return ok(res);
  }),
];

exports.getContestList = handler(async (req, res) => {
  await ensureContestV2Schema();
  await ensureContestRatingSchema();
  const { offset, limit } = paginate(req);
  const visibility = contestListVisibility(req);
  // kind: 比赛列表与作业列表分离（作业 = format='homework'）
  const kindCond = req.body.kind === 'homework'
    ? "c.format='homework'"
    : "(c.format IS NULL OR c.format<>'homework')";
  const where = visibility.where ? `${visibility.where} AND ${kindCond}` : `WHERE ${kindCond}`;
  const list = await db.query(
    'SELECT c.cid,c.title,c.start,c.length,c.isPublic,c.type,c.format,c.host,c.done,c.ratingEnabled,u.name as hostName ' +
    `FROM contest c INNER JOIN userInfo u ON u.uid = c.host ${where} ORDER BY c.start DESC LIMIT ?,?`,
    [...visibility.params, offset, limit]
  );
  for (const c of list) {
    const status = contestStatus(c);
    c.format = normalizeFormat(c.format);
    c.type = formatLabel(c.format);
    c.status = cstatus[status];
    c.start = Format(c.start);
    c.ratingEnabled = !!c.ratingEnabled;
    await attachContestRatingStatus(c, status);
    c.playerCnt = await playerCnt(c.cid);
  }
  const cnt = await db.one(`SELECT COUNT(*) as total FROM contest c ${where}`, visibility.params);
  return ok(res, { total: cnt.total, data: list });
});

exports.getContestInfo = handler(async (req, res) => {
  await ensureContestV2Schema();
  await ensureContestRatingSchema();
  const { cid } = req.body;
  const contest = await db.one(
    'SELECT c.cid,c.title,c.start,c.length,c.isPublic,c.type,c.format,c.config,c.phase,c.host,c.description,c.lang,c.done,c.ratingEnabled,u.name as hostName ' +
    'FROM contest c INNER JOIN userInfo u ON u.uid = c.host WHERE cid=?',
    [cid]
  );
  if (!contest) return fail(res, '无此比赛');

  const v = await resolveView(req, contest);
  const { caps, status } = v;
  contest.isReg = v.isReged;
  if (!caps.canEnter) return fail(res, '比赛私有，请联系管理员报名');
  contest.phase = await advanceSystestPhase(contest);

  contest.playerCnt = await playerCnt(contest.cid);
  contest.end = Format(new Date(new Date(contest.start).getTime() + contest.length * 1000 * 60));
  contest.regAble = caps.canRegister;
  contest.unregAble = caps.canUnregister;
  contest.auth = {
    join: caps.canJoin,
    view: caps.canViewScoreboard,
    manage: caps.manage,
    hack: caps.canHack,
    viewHacks: caps.canViewHacks,
    teamMode: caps.teamMode,
    inLateWindow: caps.inLateWindow,
    canSubmit: caps.canSubmit,
  };
  contest.format = normalizeFormat(contest.format);
  contest.type = formatLabel(contest.format);
  // config：生效配置（preset+覆盖）；configPatch：管理端保存的原始覆盖
  let configPatch = null;
  try { configPatch = contest.config ? JSON.parse(contest.config) : null; } catch (_) { configPatch = null; }
  contest.config = resolveConfig(contest);
  contest.configPatch = configPatch;
  contest.ratingEnabled = !!contest.ratingEnabled;
  await attachContestRatingStatus(contest, status);
  contest.start = Format(contest.start);
  contest.status = cstatus[status];
  return ok(res, { data: contest });
});

// ---- 选手管理/报名 ----

exports.addPlayer = handler(async (req, res) => {
  const { cid, name } = req.body;
  const allowed = await canManageContest(req, cid);
  if (allowed === null) return fail(res, '无此比赛');
  if (!allowed) return res.status(403).end('403 Forbidden');

  const user = await db.one('SELECT uid FROM userInfo WHERE name=? LIMIT 1', [name]);
  if (!user) return fail(res, '无此用户');

  const already = await db.exists(
    'SELECT 1 FROM contestPlayer WHERE cid=? AND uid=?',
    [cid, user.uid]
  );
  if (already) return fail(res, '此用户已被添加入比赛');

  await db.query('INSERT INTO contestPlayer(cid,uid) VALUES (?,?)', [cid, user.uid]);
  return ok(res);
});

exports.removePlayer = handler(async (req, res) => {
  const { cid } = req.body;
  const allowed = await canManageContest(req, cid);
  if (allowed === null) return fail(res, '无此比赛');
  if (!allowed) return res.status(403).end('403 Forbidden');

  const ids = (req.body.list || []).map((x) => x.id);
  if (!ids.length) return ok(res);
  const r = await db.query('DELETE FROM contestPlayer WHERE id in(?) AND cid=?', [ids, cid]);
  if (!r.affectedRows) return fail(res, 'error');
  return ok(res);
});

exports.getPlayerList = handler(async (req, res) => {
  const { offset, limit } = paginate(req);
  const { cid } = req.body;
  const list = await db.query(
    'SELECT pl.id,pl.uid,u.name FROM contestPlayer pl INNER JOIN userInfo u ON u.uid = pl.uid WHERE pl.cid=? LIMIT ?,?',
    [cid, offset, limit]
  );
  const cnt = await db.one('SELECT COUNT(*) as total FROM contestPlayer WHERE cid=?', [cid]);
  return ok(res, { total: cnt.total, data: list });
});

exports.contestReg = handler(async (req, res) => {
  const { cid } = req.body;
  const v = await loadView(req, cid);
  if (!v) return fail(res, '无此比赛');
  if (!v.caps.canRegister)
    return fail(res, '比赛已结束或私有，请联系管理员');

  await db.query('INSERT INTO contestPlayer(cid,uid) VALUES (?,?)', [cid, req.session.uid]);
  return ok(res);
});

exports.cancelContestReg = handler(async (req, res) => {
  await ensureContestV2Schema();
  const { cid } = req.body;
  const v = await loadView(req, cid);
  if (!v) return fail(res, '无此比赛');
  if (!v.caps.canUnregister)
    return fail(res, '只有未开始的公开个人赛可以取消报名');

  const player = await db.one('SELECT teamId FROM contestPlayer WHERE cid=? AND uid=? LIMIT 1', [cid, req.session.uid]);
  if (!player) return fail(res, '你尚未报名本场比赛');
  if (player.teamId) return fail(res, '组队比赛请在队伍页退出队伍');

  const hasSubmission = await db.exists('SELECT 1 FROM submission WHERE cid=? AND uid=? LIMIT 1', [cid, req.session.uid]);
  if (hasSubmission) return fail(res, '已有提交记录，无法取消报名');

  const r = await db.query('DELETE FROM contestPlayer WHERE cid=? AND uid=?', [cid, req.session.uid]);
  if (!r.affectedRows) return fail(res, '取消报名失败');
  invalidateStandings(cid);
  return ok(res);
});

// ---- 结束比赛 ----

exports.closeContest = [
  handler(async (req, res) => {
    await ensureContestRatingSchema();
    const { cid } = req.body;
    const contest = await getContest(cid);
    if (!contest) return fail(res, '无此比赛');
    if (!(await canManageContest(req, cid)))
      return fail(res, '你只能修改自己的比赛');
    const status = contestStatus(contest);
    if (status < 2) return fail(res, '还未至比赛截止时间');
    if (status === 3) return fail(res, '比赛已结束');

    const r = await db.query('UPDATE contest SET done=1 WHERE cid=?', [cid]);
    if (!r.affectedRows) return fail(res, 'error');
    // 固化官方最终榜（回放引擎全量、无掩码）
    try {
      await persistFinalStandings(cid);
    } catch (err) {
      console.error('persist final standings failed:', err && err.stack ? err.stack : err);
    }
    let rating = null;
    try {
      const result = await applyContestRating(cid);
      rating = await ratingWriteResultPayload(result, {
        includeConflict: true,
        includeStorageHealth: true,
      });
    } catch (err) {
      console.error('contest rating apply failed:', err && err.stack ? err.stack : err);
      rating = { applied: false, error: 'RATING_FAILED' };
    }
    return ok(res, { rating });
  }),
];

// ---- 题目 ----

exports.getPlayerProblemList = handler(async (req, res) => {
  const { cid } = req.body;
  const v = await loadView(req, cid);
  if (!v) return fail(res, '无此比赛');
  if (!v.caps.canViewProblems) return res.status(403).end('403 Forbidden');

  const data = await db.query(
    'SELECT cp.idx,p.title,cp.weight,p.publisher as publisherUid,u.name as publisher ' +
    'FROM contestProblem cp INNER JOIN problem p ON cp.pid = p.pid INNER JOIN userInfo u ON p.publisher = u.uid ' +
    'WHERE cp.cid=?',
    [cid]
  );
  return ok(res, { data });
});

exports.getProblemInfo = handler(async (req, res) => {
  const { cid, idx } = req.body;
  const v = await loadView(req, cid);
  if (!v) return fail(res, '无此比赛');
  if (!v.caps.canViewProblems) return res.status(403).end('403 Forbidden');

  const pinfo = await getProblemByIdx(cid, idx);
  if (!pinfo) return fail(res, '无此题目');

  const problem = await db.one(
    'SELECT p.title,p.description,p.time,p.timeLimit,p.memoryLimit,p.type,p.lang,p.publisher as publisherUid,u.name as publisher ' +
    'FROM problem p INNER JOIN userInfo u ON u.uid = p.publisher WHERE pid=?',
    [pinfo.pid]
  );
  if (!problem) return fail(res, '无此题目');

  if (v.caps.manage) problem.pid = pinfo.pid;
  problem.lang = (await getProblemLang(pinfo.pid)) & v.contest.lang;
  problem.samples = await loadProblemSamples(pinfo.pid);
  problem.type = ptype[problem.type];
  problem.time = briefFormat(problem.time);
  problem.idx = idx;
  problem.id = pinfo.id;
  return ok(res, { data: problem });
});

exports.getProblemList = [
  handler(async (req, res) => {
    const { cid } = req.body;
    const contest = await getContest(cid);
    if (!contest) return fail(res, '无此比赛');
    if (!(await canManageContest(req, cid))) return res.status(403).end('403 Forbidden');

    const data = await db.query(
      'SELECT cp.idx,cp.pid,p.title,p.time,cp.weight,p.isPublic,p.publisher as publisherUid,u.name as publisher ' +
      'FROM contestProblem cp INNER JOIN problem p ON cp.pid = p.pid INNER JOIN userInfo u ON p.publisher = u.uid ' +
      'WHERE cp.cid=?',
      [cid]
    );
    for (const r of data) r.time = briefFormat(r.time);
    return ok(res, { data });
  }),
];

exports.updateProblemList = [
  handler(async (req, res) => {
    const { cid, list } = req.body;
    const seen = {};
    const unilist = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (!item.pid || !item.weight) return fail(res, '请确认信息完善');
      if (seen[item.pid]) continue;
      seen[item.pid] = true;
      const weight = parseInt(item.weight, 10);
      if (weight < 10 || weight > 10000)
        return fail(res, `题目#${item.pid}的满分应为[10,10000]之间的整数`);
      unilist.push({ pid: item.pid, weight, idx: i + 1 });
    }
    const contest = await getContest(cid);
    if (!contest) return fail(res, '无此比赛');
    if (!(await canManageContest(req, cid)))
      return fail(res, '你只能修改自己的比赛');
    if (contestStatus(contest) === 3) return fail(res, '比赛已结束');

    for (const p of unilist) {
      const auth = await problemAuth(req, p.pid);
      if (!auth.view) return fail(res, `无权限查看题目#${p.pid}`);
    }

    await db.tx(async (tx) => {
      await tx.query('DELETE FROM contestProblem WHERE cid=?', [cid]);
      for (const p of unilist) {
        await tx.query(
          'INSERT INTO contestProblem(cid,pid,idx,weight) VALUES (?,?,?,?)',
          [cid, p.pid, p.idx, p.weight]
        );
      }
    });
    return ok(res);
  }),
];

// ---- 提交 ----

exports.submit = handler(async (req, res) => {
  const { code, cid, idx, lang } = req.body;
  const uid = req.session.uid;
  if (!cid || !idx) return fail(res, '请确认信息完善');
  if (code.length < 10) return fail(res, '代码太短');
  if (code.length > 1024 * 100) return fail(res, '选手提交的程序源文件必须不大于 100KB。');
  // 失败信息顺序与旧版一致：先查报名，再查比赛存在/时间窗。
  // 报名判定走 view.isReged（正式报名或活跃 VP 会话都算），VP 的时间窗由
  // policy 的虚拟时钟推导。
  await ensureVirtualSchema();
  const v = await loadView(req, cid);
  if (!v) {
    if (!(await isReg(uid, cid))) return fail(res, '请先报名比赛');
    return fail(res, '无此比赛');
  }
  if (!v.isReged) return fail(res, '请先报名比赛');
  const contest = v.contest;
  // 作业迟交窗口内 canSubmit 仍为真（得分由榜单层按提交时刻打折）
  if (!v.caps.canSubmit) return fail(res, '非比赛时间');

  const pinfo = await getProblemByIdx(cid, idx);
  if (!pinfo) return fail(res, '无此题目');
  let alang = await getProblemLang(pinfo.pid);
  alang &= contest.lang;
  if (!((1 << lang) & alang)) return fail(res, '非法语言');
  if (req.body.id !== pinfo.id) {
    return res.status(202).send({ refresh: true, message: '题目列表已更新，请重新查看题目列表提交' });
  }

  // CF 赛制进行中：只评 pretest（终测由 systest 统一重测）
  const cfg = resolveConfig(contest);
  const judgeScope =
    contest.format === 'cf' && cfg.cf && cfg.cf.pretestEnabled ? 'pretest' : null;

  // 虚拟提交：落 virtualId，且不碰任何官方状态（problem.submitCnt、
  // contestLastSubmission、官方榜缓存）—— 官方统计不被 VP 污染是第一不变量。
  const vid = v.virtual ? v.virtual.vid : null;
  const insertId = await db.tx(async (tx) => {
    const r = await tx.query(
      'INSERT INTO submission(pid,uid,code,codelength,submitTime,cid,lang,judgeScope,virtualId) VALUES (?,?,?,?,?,?,?,?,?)',
      [pinfo.pid, uid, code, code.length, new Date(), cid, lang, judgeScope, vid]
    );
    if (!r.affectedRows) throw new Error('insert failed');
    if (!vid) {
      await tx.query('UPDATE problem SET submitCnt=submitCnt+1 WHERE pid=?', [pinfo.pid]);
      await tx.query(
        'DELETE FROM contestLastSubmission WHERE cid=? AND uid=? AND pid=?',
        [cid, uid, pinfo.pid]
      );
      await tx.query(
        'INSERT INTO contestLastSubmission (cid,uid,pid,sid) VALUES (?,?,?,?)',
        [cid, uid, pinfo.pid, r.insertId]
      );
    }
    return r.insertId;
  });

  pushSidIntoQueue(insertId, false);
  if (vid) invalidateVirtualStandings(vid);
  else invalidateStandings(cid);
  return ok(res);
});

// ---- 提交记录 ----

exports.getSubmissionList = handler(async (req, res) => {
  const { cid } = req.body;
  const { offset, limit } = paginate(req);
  const v = await loadView(req, cid);
  if (!v) return fail(res, '无此比赛');
  if (!v.caps.canViewSubmissionList) return res.status(403).end('403 Forbidden');

  // 视图隔离：VP 进行中只看本人本次虚拟提交；VP 结束后本人可传 virtual:true
  // 回看自己的虚拟提交；其余（官方视图）一律排除虚拟提交。
  await ensureVirtualSchema();
  const conds = [];
  const params = [cid];
  if (v.virtual) {
    conds.push('s.virtualId=?');
    params.push(v.virtual.vid);
  } else if (req.body.virtual && req.session.uid) {
    conds.push('s.uid=?', 's.virtualId IS NOT NULL');
    params.push(req.session.uid);
  } else {
    conds.push('s.virtualId IS NULL');
  }
  if (req.body.uid) {
    conds.push('s.uid=?');
    params.push(req.body.uid);
  }
  const extra = ` AND ${conds.join(' AND ')}`;
  const list = await db.query(
    'SELECT s.sid,s.uid,s.pid,s.judgeResult,s.judgeScope,s.time,s.memory,s.score,s.codeLength,s.submitTime,s.machine,s.lang,u.name,p.title ' +
    'FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid ' +
    `WHERE s.cid=?${extra} ORDER BY s.sid DESC LIMIT ?,?`,
    [...params, offset, limit]
  );
  const ctx = { cid, caps: v.caps, format: v.contest.format };
  for (const r of list) await formatContestSubmissionRow(r, ctx);

  const cnt = await db.one(
    `SELECT COUNT(*) as cnt FROM submission s WHERE s.cid=?${extra}`,
    params
  );
  return ok(res, { data: list, total: cnt.cnt });
});

exports.getLastSubmissionList = handler(async (req, res) => {
  const { cid } = req.body;
  const { offset, limit } = paginate(req);
  const v = await loadView(req, cid);
  if (!v) return fail(res, '无此比赛');
  if (!v.caps.canViewSubmissionList) return res.status(403).end('403 Forbidden');

  const list = await db.query(
    `SELECT s.sid,s.uid,s.pid,s.judgeResult,s.judgeScope,s.time,s.memory,s.score,s.codeLength,s.submitTime,s.machine,s.lang,u.name,p.title
       FROM contestLastSubmission cls
       INNER JOIN submission s ON s.sid=cls.sid AND s.cid=cls.cid AND s.uid=cls.uid AND s.pid=cls.pid
       INNER JOIN userInfo u ON u.uid=s.uid
       INNER JOIN problem p ON p.pid=s.pid
      WHERE cls.cid=?
      ORDER BY s.sid DESC
      LIMIT ?,?`,
    [cid, offset, limit]
  );
  const cnt = await db.one(
    `SELECT COUNT(*) AS cnt
       FROM contestLastSubmission cls
       INNER JOIN submission s ON s.sid=cls.sid AND s.cid=cls.cid AND s.uid=cls.uid AND s.pid=cls.pid
      WHERE cls.cid=?`,
    [cid]
  );
  const ctx = { cid, caps: v.caps, format: v.contest.format };
  for (const r of list) await formatContestSubmissionRow(r, ctx);
  return ok(res, { data: list, total: Number(cnt && cnt.cnt || 0) });
});

// Same shape as judge.js#loadSubmissionInfo, used by both the POST
// getSubmissionInfo handler and the SSE streamSubmissionInfo bridge.
const loadContestSubmissionInfo = async (req, sid) => {
  const row = await db.one(
    'SELECT s.sid,s.uid,s.cid,s.pid,s.judgeResult,s.judgeScope,s.time,s.memory,s.score,s.code,s.codeLength,s.submitTime,s.compileResult,s.caseResult,s.machine,s.lang,u.name,p.title,p.judgeProfile AS problemJudgeProfile ' +
    'FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid WHERE sid=?',
    [sid]
  );
  if (!row) return { status: 202, message: 'error' };

  const contest = await getContest(row.cid);
  if (!contest) return { status: 202, message: '无此比赛' };
  const v = await resolveView(req, contest);
  const { caps } = v;

  row.canRejudge = caps.canRejudge;
  if (!caps.canViewSubmissionOf(row.uid)) return { status: 403 };
  row.judgeProfileSummary = summarizeJudgeProfile(row.problemJudgeProfile);
  delete row.problemJudgeProfile;

  row.caseResult = row.caseResult ? JSON.parse(row.caseResult) : null;
  row.singleCaseResult = await db.query('SELECT * FROM submissionDetail WHERE sid=?', [sid]);
  row.singleCaseResult.sort((a, b) => a.caseId - b.caseId);
  row.done = false;

  // fullView reveals testdata I/O and judge details.
  const fullView = caps.fullSubmissionView;

  if (row.caseResult) {
    const subtaskInfo = {};
    for (const c of row.caseResult) {
      c.index = parseInt(c.index, 10);
      c.res = judgeRes[c.res];
      c.memory = kbFormat(c.memory);
      subtaskInfo[c.index] = { info: c, cases: [] };
    }
    for (const c of row.singleCaseResult) {
      formatCaseRow(c);
      if (!fullView) {
        c.input = '正在比赛中...';
        c.output = '正在比赛中...';
        c.compareResult = '正在比赛中...';
      }
      subtaskInfo[c.subtaskId]['cases'].push(c);
    }
    row.subtaskInfo = subtaskInfo;
    row.done = true;
    delete row.caseResult;
    delete row.singleCaseResult;
  } else {
    for (const c of row.singleCaseResult) {
      delete c.input;
      delete c.output;
      delete c.compareResult;
      formatCaseRow(c);
    }
  }
  if (fullView) {
    row.judgeLog = await readJudgeLogEntries(sid);
    row.judgeLogRestricted = false;
  } else {
    row.judgeLog = [];
    row.judgeLogRestricted = true;
  }
  // OI 式遮蔽：非管理员选手只能看到提交时间，不能看到结果
  if (caps.scrubSubmissionRow) {
    row.caseResult = row.singleCaseResult = row.subtaskInfo = null;
    row.score = row.judgeResult = row.time = row.memory = 0;
    row.unShown = true;
    row.judgeLog = [];
    row.judgeLogRestricted = true;
  }
  row.idx = await getIdxByPid(row.cid, row.pid);
  delete row.pid;
  const pretestPassed = v.contest.format === 'cf' && row.judgeScope === 'pretest' && row.judgeResult === 4;
  formatSubmissionRow(row);
  if (pretestPassed) row.judgeResult = 'Pretests Passed';
  return { data: row };
};

exports.getSubmissionLog = handler(async (req, res) => {
  const sid = parseInt(req.body.sid, 10);
  if (!sid) return fail(res, 'bad sid');

  const row = await db.one('SELECT sid,uid,cid FROM submission WHERE sid=?', [sid]);
  if (!row) return fail(res, 'error');

  const contest = await getContest(row.cid);
  if (!contest) return fail(res, '无此比赛');
  const v = await resolveView(req, contest);

  if (!v.caps.canViewSubmissionOf(row.uid)) return res.status(403).end('403 Forbidden');

  if (!v.caps.fullSubmissionView) {
    return ok(res, { data: { entries: [], restricted: true } });
  }

  const entries = await readJudgeLogEntries(sid);
  return ok(res, { data: { entries, restricted: false } });
});

exports.getSubmissionInfo = handler(async (req, res) => {
  const r = await loadContestSubmissionInfo(req, req.body.sid);
  if (r.status === 403) return res.status(403).end('403 Forbidden');
  if (r.status) return fail(res, r.message || 'error', r.status);
  return ok(res, { data: r.data });
});

exports.streamSubmissionInfo = (req, res) =>
  streamSubmission(req, res, loadContestSubmissionInfo, req.query.sid);

// ---- 排行榜 ----

exports.getRank = handler(async (req, res) => {
  await ensureContestRatingSchema();
  const { cid } = req.body;
  const v = await loadView(req, cid);
  if (!v) return fail(res, '无此比赛');
  if (!v.caps.canViewScoreboard) return res.status(403).end('403 Forbidden');
  const { contest, status } = v;

  const [result, ratingStatus] = await Promise.all([
    buildContestRank(cid, { masked: v.caps.scoreboardMasked, virtual: v.virtual || undefined }),
    contestRatingStatusForContest(contest, status),
  ]);
  const showRating = !!contest.done && !!contest.ratingEnabled;
  const ratingRows = showRating ? await ratingRowsForContest(cid) : [];
  const ratingByUid = new Map(ratingRows.map((row) => [Number(row.uid), row]));
  for (const row of result.rank) {
    const rating = ratingByUid.get(Number(row.user.uid));
    if (rating) {
      row.ratingChange = {
        rank: Number(rating.rank),
        oldRating: Number(rating.oldRating),
        newRating: Number(rating.newRating),
        delta: Number(rating.delta),
      };
      row.user.rating = Number(rating.newRating);
    }
  }
  const ratingMeta = ratingStatusResponseMeta(ratingStatus);
  return ok(res, {
    data: result.rank,
    problem: result.problem,
    rating: ratingRows,
    ...ratingMeta,
    unrated: !showRating || ratingMeta.unrated,
  });
});

// 任意时刻榜单（时间轴回放 + 分页）。t 单位秒（相对比赛开始），缺省 = 当前进度。
exports.getRankAt = handler(async (req, res) => {
  const { cid } = req.body;
  const v = await loadView(req, cid);
  if (!v) return fail(res, '无此比赛');
  if (!v.caps.canViewScoreboard) return res.status(403).end('403 Forbidden');

  const { offset, limit, pageId, pageSize } = paginate(req, 50);
  const t = req.body.t == null ? null : Number(req.body.t);
  // VP 进行中：合榜视图（官方 ghost + 本人虚拟提交），回放进度按虚拟时钟
  const result = await computeStandings(cid, {
    atSec: t == null || Number.isNaN(t) ? null : t,
    masked: v.caps.scoreboardMasked,
    virtual: v.virtual || undefined,
  });
  if (!result) return fail(res, '无此比赛');

  // 赛后附加 rating 变化（与 getRank 一致，仅整场 join 一次）
  const showRating = !!v.contest.done && !!v.contest.ratingEnabled;
  if (showRating) {
    const ratingRows = await ratingRowsForContest(cid);
    const ratingByUid = new Map(ratingRows.map((row) => [Number(row.uid), row]));
    for (const row of result.rank) {
      const rating = ratingByUid.get(Number(row.user.uid));
      if (rating) {
        row.ratingChange = {
          rank: Number(rating.rank),
          oldRating: Number(rating.oldRating),
          newRating: Number(rating.newRating),
          delta: Number(rating.delta),
        };
        row.user.rating = Number(rating.newRating);
      }
    }
  }

  // 组队模式：标记「我的队」用于高亮（成员含当前用户）
  const viewerUid = req.session.uid;
  for (const row of result.rank) {
    row.mine = row.user.uid === viewerUid ||
      (Array.isArray(row.members) && row.members.some((m) => m.uid === viewerUid));
  }

  return ok(res, {
    total: result.rank.length,
    pageId,
    pageSize,
    data: result.rank.slice(offset, offset + limit),
    problem: result.problem,
    problemStats: result.problemStats,
    format: result.format,
    teamMode: !!(v.cfg.team && v.cfg.team.enabled),
    atSec: result.atSec,
    horizonSec: result.horizonSec,
    durationSec: result.durationSec,
    frozen: result.frozen,
    freezeStartSec: v.caps.scoreboardMasked ? result.freezeStartSec : null,
    done: !!v.contest.done,
  });
});

// 单个选手（队）的分数+排名时间线（选手曲线图）。participant 可传 uid 或 't<teamId>'。
exports.getParticipantTimeline = handler(async (req, res) => {
  const { cid } = req.body;
  const participant = req.body.participant != null ? req.body.participant : req.body.uid;
  const v = await loadView(req, cid);
  if (!v) return fail(res, '无此比赛');
  if (!v.caps.canViewScoreboard) return res.status(403).end('403 Forbidden');

  const result = await participantTimeline(cid, participant, {
    masked: v.caps.scoreboardMasked,
    virtual: v.virtual || undefined,
  });
  if (!result) return fail(res, '无此比赛');
  return ok(res, result);
});

// 启动终测（CF）：pretest 通过的提交按全量数据 + 成功 hack 数据重测
exports.startSystest = handler(async (req, res) => {
  const { cid } = req.body;
  const contest = await getContest(cid);
  if (!contest) return fail(res, '无此比赛');
  if (!(await canManageContest(req, cid))) return res.status(403).end('403 Forbidden');
  if (contest.format !== 'cf') return fail(res, '仅 CF 赛制支持终测');
  if (contestStatus(contest) < 2) return fail(res, '比赛还未到截止时间');
  if (Number(contest.phase) >= 1) return fail(res, '终测已启动');

  // 终测只覆盖正式提交；VP 的 pretest 提交在其会话结束时单独转全量（virtual.js）
  await ensureVirtualSchema();
  const sids = await db.column(
    'SELECT sid FROM submission WHERE cid=? AND judgeResult=4 AND virtualId IS NULL', [cid], 'sid'
  );
  await db.query('UPDATE contest SET phase=1 WHERE cid=?', [cid]);
  await db.query('UPDATE submission SET judgeScope=NULL WHERE cid=? AND virtualId IS NULL', [cid]);
  // 与 judge/core.js reJudgeContest 相同的重置+入队方式
  for (const sid of sids) {
    await db.query(
      'UPDATE submission SET judgeResult=13,time=0,memory=0,score=0,compileResult=NULL,caseResult=NULL WHERE sid=?',
      [sid]
    );
    pushSidIntoQueue(sid, true);
  }
  invalidateStandings(cid);
  return ok(res, { total: sids.length });
});

// 终测收尾：phase=1 且场内无待评测提交时推进到 phase=2（getContestInfo 顺带调用）
const advanceSystestPhase = async (contest) => {
  if (contest.format !== 'cf' || Number(contest.phase) !== 1) return contest.phase;
  await ensureVirtualSchema();
  const pending = await db.one(
    'SELECT COUNT(*) AS cnt FROM submission WHERE cid=? AND judgeResult IN (0,1,2,13) AND virtualId IS NULL',
    [contest.cid]
  );
  if (Number(pending && pending.cnt || 0) === 0) {
    await db.query('UPDATE contest SET phase=2 WHERE cid=? AND phase=1', [contest.cid]);
    return 2;
  }
  return 1;
};

// 手动解榜/重新封榜（管理员）：写入 config 覆盖 scoreboard.freeze.revealed
exports.setScoreboardReveal = handler(async (req, res) => {
  const { cid } = req.body;
  const contest = await getContest(cid);
  if (!contest) return fail(res, '无此比赛');
  if (!(await canManageContest(req, cid))) return res.status(403).end('403 Forbidden');

  const revealed = !!req.body.revealed;
  let patch = null;
  try { patch = contest.config ? JSON.parse(contest.config) : null; } catch (_) { patch = null; }
  patch = deepMerge(patch || {}, { scoreboard: { freeze: { revealed } } });
  await db.query('UPDATE contest SET config=? WHERE cid=?', [JSON.stringify(patch), cid]);
  invalidateStandings(cid);
  return ok(res, { revealed });
});

exports.getSingleUserLastSubmission = handler(async (req, res) => {
  const { cid, uid } = req.body;
  const v = await loadView(req, cid);
  if (!v) return fail(res, '无此比赛');
  if (!v.caps.canViewSubmissionList) return res.status(403).end('403 Forbidden');

  const list = await db.query(
    `SELECT s.sid,s.uid,s.pid,s.judgeResult,s.judgeScope,s.time,s.memory,s.score,s.codeLength,s.submitTime,s.machine,s.lang,u.name,p.title
       FROM contestLastSubmission cls
       INNER JOIN submission s ON s.sid=cls.sid AND s.cid=cls.cid AND s.uid=cls.uid AND s.pid=cls.pid
       INNER JOIN userInfo u ON u.uid=s.uid
       INNER JOIN problem p ON p.pid=s.pid
      WHERE cls.cid=? AND cls.uid=?
      ORDER BY s.sid DESC`,
    [cid, uid]
  );
  if (!list.length) return ok(res, { data: [], total: 0 });
  const ctx = { cid, caps: v.caps, format: v.contest.format };
  for (const r of list) await formatContestSubmissionRow(r, ctx);
  return ok(res, { data: list });
});

exports.getSingleUserProblemSubmission = handler(async (req, res) => {
  const { cid, uid, idx } = req.body;
  const v = await loadView(req, cid);
  if (!v) return fail(res, '无此比赛');
  if (!v.caps.canViewSubmissionList) return res.status(403).end('403 Forbidden');

  const pinfo = await getProblemByIdx(cid, idx);
  if (!pinfo) return fail(res, '无此题目');

  // 榜单单元格点开的提交列表：VP 视图下点自己的行看本次虚拟提交，
  // 点 ghost 行看官方提交；官方视图一律排除虚拟提交。
  await ensureVirtualSchema();
  const mineVirtual = v.virtual && Number(uid) === Number(req.session.uid);
  const vcond = mineVirtual ? ' AND s.virtualId=?' : ' AND s.virtualId IS NULL';
  const vparams = mineVirtual ? [v.virtual.vid] : [];
  const list = await db.query(
    'SELECT s.sid,s.uid,s.pid,s.judgeResult,s.judgeScope,s.time,s.memory,s.score,s.codeLength,s.submitTime,s.machine,s.lang,u.name,p.title ' +
    'FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid ' +
    `WHERE s.cid=? AND s.uid=? AND s.pid=?${vcond} ORDER BY s.sid DESC`,
    [cid, uid, pinfo.pid, ...vparams]
  );
  for (const r of list) {
    r.idx = idx;
    r.pid = null;
    r.submitTime = Format(r.submitTime);
    if (v.caps.scrubSubmissionRow) {
      r.score = r.judgeResult = r.time = r.memory = 0;
    }
    r.judgeResult = judgeRes[r.judgeResult];
    r.memory = kbFormat(r.memory);
  }
  return ok(res, { data: list });
});
