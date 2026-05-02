const db = require('../db');
const { handler, fail, ok, paginate } = require('../db/util');
const { requirePermission } = require('../auth/middleware');
const { Format, briefFormat, kbFormat } = require('../static');
const { judgeRes, formatSubmissionRow, formatCaseRow, ctype, cstatus } = require('../db/format');
const { pushSidIntoQueue } = require('./judge');
const { getProblemLang } = require('./problem');

const ctypeToIndex = { OI: 0, IOI: 1 };
const ptype = ['传统文本比较', 'Special Judge'];

// ---- shared helpers ----
// Owner of a contest, OR holder of contest.edit.any (global or scoped to this cid).
const canManageContest = (req, contest) => {
  if (!contest) return false;
  if (contest.host === req.session.uid) return true;
  return req.can('contest.edit.any', { type: 'contest', id: Number(contest.cid) });
};

const contestStatus = (info) => {
  if (info.done) return 3;
  if (Date.now() > info.start.getTime() + info.length * 1000 * 60) return 2;
  return Date.now() >= info.start.getTime() ? 1 : 0;
};

const isReg = (uid, cid) =>
  db.exists('SELECT 1 FROM contestPlayer WHERE uid=? AND cid=? LIMIT 1', [uid, cid]);

const playerCnt = async (cid) => {
  const r = await db.one('SELECT COUNT(*) as cnt FROM contestPlayer WHERE cid=?', [cid]);
  return r.cnt;
};

const getProblemByIdx = (cid, idx) =>
  db.one('SELECT pid,id FROM contestProblem WHERE cid=? AND idx=? LIMIT 1', [cid, idx]);

const getIdxByPid = async (cid, pid) => {
  const r = await db.one('SELECT idx FROM contestProblem WHERE cid=? AND pid=? LIMIT 1', [cid, pid]);
  return r ? r.idx : null;
};

const getContest = (cid) => db.one('SELECT * FROM contest WHERE cid=?', [cid]);

// 主审核流程：可不可以查看比赛中的题目/提交。返回 { contest, status, isReged, canView } 或 null（无此比赛）
const loadContestForView = async (req, cid) => {
  const contest = await getContest(cid);
  if (!contest) return null;
  contest.status = contestStatus(contest);
  const isReged = await isReg(req.session.uid, cid);
  const canView =
    (contest.status === 3 && (contest.isPublic || isReged)) ||
    (isReged && contest.status > 0) ||
    canManageContest(req, contest);
  return { contest, status: contest.status, isReged, canView };
};

// During an OI contest in progress, regular contestants see scrubbed scores/results.
// `manager` here means the user can manage the contest (owner / contest.edit.any).
const formatContestSubmissionRow = async (r, ctx) => {
  r.idx = await getIdxByPid(ctx.cid, r.pid);
  r.pid = null;
  r.submitTime = Format(r.submitTime);
  if (!ctx.contest.type && !ctx.contest.done && !ctx.manager) {
    r.score = r.judgeResult = r.time = r.memory = 0;
  }
  r.judgeResult = judgeRes[r.judgeResult];
  r.memory = kbFormat(r.memory);
  return r;
};

// ---- handlers ----
exports.createContest = [
  requirePermission('contest.create'),
  handler(async (req, res) => {
    const r = await db.query(
      'INSERT INTO contest(title,host,start,length,type,isPublic) VALUES (?,?,?,?,?,?)',
      ['请输入比赛标题', req.session.uid, new Date(2121, 10, 22), 180, 0, 0]
    );
    if (!r.affectedRows) return fail(res, 'error');
    return ok(res, { cid: r.insertId });
  }),
];

exports.updateContestInfo = [
  handler(async (req, res) => {
    const { cid, info } = req.body;
    const contest = await getContest(cid);
    if (!contest) return fail(res, '无此比赛');
    if (!canManageContest(req, contest))
      return fail(res, '你只能修改自己的比赛');
    if (contest.done) return fail(res, '比赛已经结束');
    if (!info.title || !info.start || !info.length || !info.type) return fail(res, '请确认信息完善');
    if (info.title.length > 30) return fail(res, '比赛名称最长30个字符');
    if (info.type > 1) return fail(res, '非法比赛类型');
    info.type = ctypeToIndex[info.type];
    if (info.isPublic !== true && info.isPublic !== false) return fail(res, '非法isPublic参数');

    const r = await db.query(
      'UPDATE contest SET title=?,description=?,start=?,length=?,type=?,isPublic=?,lang=? WHERE cid=?',
      [info.title, info.description, new Date(info.start), info.length, info.type, info.isPublic, info.lang, cid]
    );
    if (!r.affectedRows) return fail(res, 'error');
    return ok(res);
  }),
];

exports.getContestList = handler(async (req, res) => {
  const { offset, limit } = paginate(req);
  const list = await db.query(
    'SELECT c.cid,c.title,c.start,c.length,c.isPublic,c.type,c.host,c.done,u.name as hostName ' +
      'FROM contest c INNER JOIN userInfo u ON u.uid = c.host ORDER BY c.start DESC LIMIT ?,?',
    [offset, limit]
  );
  for (const c of list) {
    c.type = ctype[c.type];
    c.status = cstatus[contestStatus(c)];
    c.start = Format(c.start);
    c.playerCnt = await playerCnt(c.cid);
  }
  const cnt = await db.one('SELECT COUNT(*) as total FROM contest');
  return ok(res, { total: cnt.total, data: list });
});

exports.getContestInfo = handler(async (req, res) => {
  const { cid } = req.body;
  const contest = await db.one(
    'SELECT c.cid,c.title,c.start,c.length,c.isPublic,c.type,c.host,c.description,c.lang,c.done,u.name as hostName ' +
      'FROM contest c INNER JOIN userInfo u ON u.uid = c.host WHERE cid=?',
    [cid]
  );
  if (!contest) return fail(res, '无此比赛');

  contest.isReg = await isReg(req.session.uid, contest.cid);
  const isManager = canManageContest(req, contest);
  if (!contest.isPublic && !contest.isReg && !isManager)
    return fail(res, '比赛私有，请联系管理员报名');

  contest.playerCnt = await playerCnt(contest.cid);
  const status = contestStatus(contest);
  contest.status = status;
  contest.end = Format(new Date(new Date(contest.start).getTime() + contest.length * 1000 * 60));
  contest.regAble = status < 2 && contest.isPublic && !contest.isReg;
  contest.auth = {
    join: (contest.isReg && status > 0) || isManager,
    view:
      status === 3 ||
      (contest.isReg && contest.type === 1 && status > 0) ||
      isManager,
  };
  contest.type = ctype[contest.type];
  contest.start = Format(contest.start);
  contest.status = cstatus[status];
  return ok(res, { data: contest });
});

// Owner / contest.player.manage / contest.edit.any (scoped or global) can manage players.
const canManagePlayers = async (req, cid) => {
  const contest = await getContest(cid);
  if (!contest) return null;
  const scope = { type: 'contest', id: Number(cid) };
  if (canManageContest(req, contest)) return contest;
  if (req.can('contest.player.manage', scope)) return contest;
  return false;
};

exports.addPlayer = handler(async (req, res) => {
  const { cid, name } = req.body;
  const allowed = await canManagePlayers(req, cid);
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
  const allowed = await canManagePlayers(req, cid);
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

exports.closeContest = [
  handler(async (req, res) => {
    const { cid } = req.body;
    const contest = await getContest(cid);
    if (!contest) return fail(res, '无此比赛');
    if (!canManageContest(req, contest))
      return fail(res, '你只能修改自己的比赛');
    const status = contestStatus(contest);
    if (status < 2) return fail(res, '还未至比赛截止时间');
    if (status === 3) return fail(res, '比赛已结束');

    const r = await db.query('UPDATE contest SET done=1 WHERE cid=?', [cid]);
    if (!r.affectedRows) return fail(res, 'error');
    return ok(res);
  }),
];

exports.contestReg = handler(async (req, res) => {
  const { cid } = req.body;
  const contest = await getContest(cid);
  if (!contest) return fail(res, '无此比赛');
  const reged = await isReg(req.session.uid, contest.cid);
  if (!contest.isPublic || contestStatus(contest) >= 2 || reged)
    return fail(res, '比赛已结束或私有，请联系管理员');

  await db.query('INSERT INTO contestPlayer(cid,uid) VALUES (?,?)', [cid, req.session.uid]);
  return ok(res);
});

exports.getPlayerProblemList = handler(async (req, res) => {
  const { cid } = req.body;
  const contest = await getContest(cid);
  if (!contest) return fail(res, '无此比赛');
  const reged = await isReg(req.session.uid, contest.cid);
  const status = contestStatus(contest);
  const allowed =
    (reged && status > 0) || canManageContest(req, contest) || ((contest.isPublic || reged) && contest.done);
  if (!allowed) return res.status(403).end('403 Forbidden');

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
  const v = await loadContestForView(req, cid);
  if (!v) return fail(res, '无此比赛');
  // 这里使用比赛进入条件，不是 view-only
  const isManager = canManageContest(req, v.contest);
  const allowed =
    (v.isReged && v.status > 0) ||
    isManager ||
    ((v.contest.isPublic || v.isReged) && v.contest.done);
  if (!allowed) return res.status(403).end('403 Forbidden');

  const pinfo = await getProblemByIdx(cid, idx);
  if (!pinfo) return fail(res, '无此题目');

  const problem = await db.one(
    'SELECT p.title,p.description,p.time,p.timeLimit,p.memoryLimit,p.type,p.lang,p.publisher as publisherUid,u.name as publisher ' +
      'FROM problem p INNER JOIN userInfo u ON u.uid = p.publisher WHERE pid=?',
    [pinfo.pid]
  );
  if (!problem) return fail(res, '无此题目');

  if (isManager) problem.pid = pinfo.pid;
  problem.lang = (await getProblemLang(pinfo.pid)) & v.contest.lang;
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
    if (!canManageContest(req, contest)) return res.status(403).end('403 Forbidden');

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
    if (!canManageContest(req, contest))
      return fail(res, '你只能修改自己的比赛');
    if (contestStatus(contest) === 3) return fail(res, '比赛已结束');

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

exports.submit = handler(async (req, res) => {
  const { code, cid, idx, lang } = req.body;
  const uid = req.session.uid;
  if (!cid || !idx) return fail(res, '请确认信息完善');
  if (code.length < 10) return fail(res, '代码太短');
  if (code.length > 1024 * 100) return fail(res, '选手提交的程序源文件必须不大于 100KB。');
  if (!(await isReg(uid, cid))) return fail(res, '请先报名比赛');

  const contest = await getContest(cid);
  if (!contest) return fail(res, '无此比赛');
  if (contestStatus(contest) !== 1) return fail(res, '非比赛时间');

  const pinfo = await getProblemByIdx(cid, idx);
  if (!pinfo) return fail(res, '无此题目');
  let alang = await getProblemLang(pinfo.pid);
  alang &= contest.lang;
  if (!((1 << lang) & alang)) return fail(res, '非法语言');
  if (req.body.id !== pinfo.id) {
    return res.status(202).send({ refresh: true, message: '题目列表已更新，请重新查看题目列表提交' });
  }

  const insertId = await db.tx(async (tx) => {
    const r = await tx.query(
      'INSERT INTO submission(pid,uid,code,codelength,submitTime,cid,lang) VALUES (?,?,?,?,?,?,?)',
      [pinfo.pid, uid, code, code.length, new Date(), cid, lang]
    );
    if (!r.affectedRows) throw new Error('insert failed');
    await tx.query('UPDATE problem SET submitCnt=submitCnt+1 WHERE pid=?', [pinfo.pid]);
    await tx.query(
      'DELETE FROM contestLastSubmission WHERE cid=? AND uid=? AND pid=?',
      [cid, uid, pinfo.pid]
    );
    await tx.query(
      'INSERT INTO contestLastSubmission (cid,uid,pid,sid) VALUES (?,?,?,?)',
      [cid, uid, pinfo.pid, r.insertId]
    );
    return r.insertId;
  });

  pushSidIntoQueue(insertId, false);
  return ok(res);
});

exports.getSubmissionList = handler(async (req, res) => {
  const { cid } = req.body;
  const { offset, limit } = paginate(req);
  const v = await loadContestForView(req, cid);
  if (!v) return fail(res, '无此比赛');
  if (!v.canView) return res.status(403).end('403 Forbidden');

  const params = [cid];
  let extra = '';
  if (req.body.uid) {
    extra = ' AND u.uid=?';
    params.push(req.body.uid);
  }
  const list = await db.query(
    'SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.codeLength,s.submitTime,s.machine,s.lang,u.name,p.title ' +
      'FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid ' +
      `WHERE cid=?${extra} ORDER BY s.sid DESC LIMIT ?,?`,
    [...params, offset, limit]
  );
  const ctx = { cid, contest: v.contest, manager: canManageContest(req, v.contest) };
  for (const r of list) await formatContestSubmissionRow(r, ctx);

  const cnt = await db.one(
    `SELECT COUNT(*) as cnt FROM submission WHERE cid=?${req.body.uid ? ' AND uid=?' : ''}`,
    req.body.uid ? [cid, req.body.uid] : [cid]
  );
  return ok(res, { data: list, total: cnt.cnt });
});

exports.getLastSubmissionList = handler(async (req, res) => {
  const { cid } = req.body;
  const { offset, limit } = paginate(req);
  const v = await loadContestForView(req, cid);
  if (!v) return fail(res, '无此比赛');
  if (!v.canView) return res.status(403).end('403 Forbidden');

  const allLast = await db.query('SELECT sid FROM contestLastSubmission WHERE cid=?', [cid]);
  const sids = allLast.slice(offset, offset + limit).map((r) => r.sid);
  if (!sids.length) return ok(res, { data: [], total: 0 });

  const list = await db.query(
    'SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.codeLength,s.submitTime,s.machine,s.lang,u.name,p.title ' +
      'FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid WHERE s.sid in (?)',
    [sids]
  );
  const ctx = { cid, contest: v.contest, manager: canManageContest(req, v.contest) };
  for (const r of list) await formatContestSubmissionRow(r, ctx);
  return ok(res, { data: list, total: allLast.length });
});

exports.getSubmissionInfo = handler(async (req, res) => {
  const { sid } = req.body;
  const row = await db.one(
    'SELECT s.sid,s.uid,s.cid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.code,s.codeLength,s.submitTime,s.compileResult,s.caseResult,s.machine,s.lang,u.name,p.title ' +
      'FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid WHERE sid=?',
    [sid]
  );
  if (!row) return fail(res, 'error');

  const contest = await getContest(row.cid);
  if (!contest) return fail(res, '无此比赛');
  contest.status = contestStatus(contest);
  const reged = await isReg(req.session.uid, row.cid);
  const isManager = canManageContest(req, contest);
  const allowed =
    (contest.status === 3 && (contest.isPublic || reged)) ||
    req.session.uid === row.uid ||
    isManager ||
    req.can('submission.view.any');
  if (!allowed) return res.status(403).end('403 Forbidden');

  row.caseResult = JSON.parse(row.caseResult);
  row.singleCaseResult = await db.query('SELECT * FROM submissionDetail WHERE sid=?', [sid]);
  row.singleCaseResult.sort((a, b) => a.caseId - b.caseId);
  row.done = false;

  const fullView = isManager || req.can('submission.view.any') || contest.status === 3;

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
  // OI 赛制比赛中：非管理员选手只能看到提交时间，不能看到结果
  if (!contest.type && !contest.done && !isManager) {
    row.caseResult = row.singleCaseResult = row.subtaskInfo = null;
    row.score = row.judgeResult = row.time = row.memory = 0;
    row.unShown = true;
  }
  row.idx = await getIdxByPid(row.cid, row.pid);
  delete row.pid;
  formatSubmissionRow(row);
  return ok(res, { data: row });
});

exports.getRank = handler(async (req, res) => {
  const { cid } = req.body;
  const submissions = await db.query('SELECT sid FROM contestLastSubmission WHERE cid=?', [cid]);
  const problems = await db.query('SELECT pid,idx,weight FROM contestProblem WHERE cid=?', [cid]);
  const playerUids = await db.column('SELECT uid FROM contestPlayer WHERE cid=?', [cid], 'uid');
  const players = playerUids.length
    ? await db.query('SELECT uid,name FROM userInfo WHERE uid in (?)', [playerUids])
    : [];
  const contest = await getContest(cid);
  const reged = await isReg(req.session.uid, cid);
  const status = contestStatus(contest);

  const allowed =
    (status === 3 && (contest.isPublic || reged)) ||
    (reged && contest.type === 1 && status > 0) ||
    canManageContest(req, contest);
  if (!allowed) return res.status(403).end('403 Forbidden');

  const pidToIdx = [];
  const pweight = [];
  const pinfo = new Map();
  for (const p of problems) {
    pidToIdx[p.pid] = p.idx;
    pweight[p.pid] = p.weight;
    pinfo[p.idx] = p.weight;
  }

  const uVis = [];
  const table = new Map();
  for (const u of players) {
    uVis[u.uid] = true;
    table[u.uid] = {
      user: u,
      totalScore: 0,
      usedTime: 0,
      detail: new Map(),
      submitted: false,
    };
  }

  const acVis = [];
  for (const s of submissions) {
    const detail = await db.one(
      'SELECT uid,pid,time,score FROM submission WHERE sid=?',
      [s.sid]
    );
    if (!detail) continue;
    const idx = pidToIdx[detail.pid];
    if (!idx || !uVis[detail.uid]) continue;
    const score = Math.round((detail.score * pweight[detail.pid]) / 100);
    table[detail.uid].detail[idx] = { score, time: detail.time };
    table[detail.uid].totalScore += score;
    if (detail.score) table[detail.uid].usedTime += detail.time;
    if (detail.score === 100) {
      if (!acVis[idx]) table[detail.uid].detail[idx].firstBlood = true;
      acVis[idx] = true;
    }
    table[detail.uid].submitted = true;
  }

  const rank = [];
  for (const uid in table) rank.push(table[uid]);
  rank.sort((a, b) => {
    if (a.totalScore !== b.totalScore) return b.totalScore - a.totalScore;
    if (a.usedTime !== b.usedTime) return a.usedTime - b.usedTime;
    if (a.submitted !== b.submitted) return b.submitted - a.submitted;
    return a.user.uid - b.user.uid;
  });
  return ok(res, { data: rank, problem: pinfo });
});

exports.getSingleUserLastSubmission = handler(async (req, res) => {
  const { cid, uid } = req.body;
  const v = await loadContestForView(req, cid);
  if (!v) return fail(res, '无此比赛');
  if (!v.canView) return res.status(403).end('403 Forbidden');

  const sids = await db.column(
    'SELECT sid FROM contestLastSubmission WHERE cid=? AND uid=?',
    [cid, uid],
    'sid'
  );
  if (!sids.length) return ok(res, { data: [], total: 0 });

  const list = await db.query(
    'SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.codeLength,s.submitTime,s.machine,s.lang,u.name,p.title ' +
      'FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid WHERE s.sid in (?)',
    [sids]
  );
  const ctx = { cid, contest: v.contest, manager: canManageContest(req, v.contest) };
  for (const r of list) await formatContestSubmissionRow(r, ctx);
  return ok(res, { data: list });
});

exports.getSingleUserProblemSubmission = handler(async (req, res) => {
  const { cid, uid, idx } = req.body;
  const v = await loadContestForView(req, cid);
  if (!v) return fail(res, '无此比赛');
  if (!v.canView) return res.status(403).end('403 Forbidden');

  const pinfo = await getProblemByIdx(cid, idx);
  if (!pinfo) return fail(res, '无此题目');

  const list = await db.query(
    'SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.codeLength,s.submitTime,s.machine,s.lang,u.name,p.title ' +
      'FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid ' +
      'WHERE s.cid=? AND s.uid=? AND s.pid=? ORDER BY s.sid DESC',
    [cid, uid, pinfo.pid]
  );
  const isManager = canManageContest(req, v.contest);
  for (const r of list) {
    r.idx = idx;
    r.pid = null;
    r.submitTime = Format(r.submitTime);
    if (!v.contest.type && !v.contest.done && !isManager) {
      r.score = r.judgeResult = r.time = r.memory = 0;
    }
    r.judgeResult = judgeRes[r.judgeResult];
    r.memory = kbFormat(r.memory);
  }
  return ok(res, { data: list });
});
