const axios = require('axios');
const async = require('async');
const { exec } = require('child_process');
const { fork } = require('child_process');
const db = require('../db');
const { handler, fail, ok, paginate, buildWhere } = require('../db/util');
const { requirePermission } = require('../auth/middleware');
const { Format, kbFormat } = require('../static');
const conf = require('../config.json');
const { updateProblemStat, problemAuth, getProblemLang } = require('./problem');
const { judgeRes, formatSubmissionRow, formatCaseRow } = require('../db/format');

// ---- judging queue ----
const judgeQueue = async.queue((submission, callback) => {
  const worker = fork(`./api/judgeWorker(${submission.lang}).js`);
  worker.on('message', (msg) => {
    if (msg.type === 'done' || msg.type === 'error') {
      worker.kill();
      callback();
    }
  });
  worker.on('error', (error) => {
    console.error(`Worker error for submission ${submission.sid}:`, error);
    worker.kill();
    callback(error);
  });
  worker.send({ type: 'judge', sid: submission.sid, isreJudge: submission.isreJudge });
}, 4);

const machines = ['localhost'];
let taskId = 0;

const pushSidIntoQueue = async (sid, isreJudge) => {
  const lang = await db.one(
    'SELECT l.name FROM languages l INNER JOIN submission s ON l.id = s.lang WHERE s.sid=?',
    [sid]
  );
  if (conf.JUDGE.ISSERVER) {
    const machine = machines[++taskId % machines.length];
    if (machine === 'localhost') {
      console.log(Format(new Date()), 'server: localJudge', sid);
      judgeQueue.push({ sid, isreJudge, lang: lang.name });
    } else {
      console.log(Format(new Date()), 'server: task assigned to', machine, sid);
      try {
        const r = await axios.post(machine, { sid, isreJudge });
        if (r.status === 200) {
          console.log(Format(new Date()), 'server:', machine, 'ok', sid);
        } else {
          console.log(Format(new Date()), 'server:', machine, 'error: status not 200', r, sid);
          pushSidIntoQueue(sid, isreJudge);
        }
      } catch (err) {
        console.log(Format(new Date()), 'server:', machine, 'error:', err, sid);
        pushSidIntoQueue(sid, isreJudge);
      }
    }
  } else {
    console.log(Format(new Date()), 'client: task received', sid, isreJudge);
    judgeQueue.push({ sid, isreJudge, lang: lang.name });
  }
};
exports.pushSidIntoQueue = pushSidIntoQueue;

// ---- shared helpers (also used by judgeWorkers) ----
exports.SubmissionInfo = (sid) => db.one('SELECT * FROM submission WHERE sid=?', [sid]);
exports.ProblemInfo = (pid) => db.one('SELECT * FROM problem WHERE pid=?', [pid]);

exports.getCompareResult = (fileSuf) =>
  new Promise((resolve) => {
    exec(`./comparer/comparer ./comparer/data.in ${fileSuf}usr.out ${fileSuf}data.out`, (err, stdout, stderr) => {
      resolve(stderr);
    });
  });

exports.setSubmission = (sid, judgeResult, time, memory, score, compileResult, caseResult, machine) =>
  db.query(
    'UPDATE submission SET judgeResult=?,time=?,memory=?,score=?,compileResult=?,caseResult=?,machine=? WHERE sid=?',
    [judgeResult, time, memory, score, compileResult, caseResult, machine, sid]
  ).then((r) => r.affectedRows).catch((err) => console.log(err));

exports.updateSubmissionDetail = (sid, caseId, input, output, time, memory, result, compareResult, subtaskId) =>
  db.query(
    'INSERT INTO submissionDetail(sid,caseId,input,output,time,memory,result,compareResult,subtaskId) values(?,?,?,?,?,?,?,?,?)',
    [sid, caseId, input, output, time, memory, result, compareResult, subtaskId]
  ).catch((err) => console.log(err));

exports.updateProblemSubmitInfo = async (pid) => {
  try {
    const total = await db.one('SELECT COUNT(*) as cnt FROM submission WHERE pid=?', [pid]);
    await db.query('UPDATE problem SET submitCnt=? WHERE pid=?', [total.cnt, pid]);
    const ac = await db.one('SELECT COUNT(*) as cnt FROM submission WHERE pid=? AND judgeResult=4', [pid]);
    await db.query('UPDATE problem SET acCnt=? WHERE pid=?', [ac.cnt, pid]);
  } catch (err) {
    console.log(err);
  }
};

exports.clearCase = (sid) =>
  db.query('DELETE FROM submissionDetail WHERE sid=?', [sid]).catch((err) => console.log(err));

exports.updateData = (pid) =>
  new Promise((resolve) => {
    exec(`./sync_data.sh ${pid}`, (err, stdout) => resolve(stdout));
  });

const getCaseDetail = (sid) => db.query('SELECT * FROM submissionDetail WHERE sid=?', [sid]);

// ---- handlers ----
exports.receiveTask = handler(async (req, res) => {
  if (conf.JUDGE.ISSERVER) return fail(res, 'This is SERVER');
  pushSidIntoQueue(req.body.sid, req.body.isreJudge);
  return ok(res, { message: 'ok' });
});

exports.submit = handler(async (req, res) => {
  const { code, pid, lang } = req.body;
  if (!pid) return fail(res, '请确认信息完善');
  const auth = await problemAuth(req, pid);
  if (!auth.view) return fail(res, '权限不足');
  if (code.length < 10) return fail(res, '代码太短');
  if (code.length > 1024 * 100) return fail(res, '选手提交的程序源文件必须不大于 100KB。');

  const alang = await getProblemLang(pid);
  if (!((1 << lang) & alang)) return fail(res, '非法语言');

  const r = await db.query(
    'INSERT INTO submission(pid,uid,code,codelength,submitTime,lang) VALUES (?,?,?,?,?,?)',
    [pid, req.session.uid, code, code.length, new Date(), lang]
  );
  if (!r.affectedRows) return fail(res, 'error');

  await db.query('UPDATE problem SET submitCnt=submitCnt+1 WHERE pid=?', [pid]);
  pushSidIntoQueue(r.insertId, false);
  return ok(res, { sid: r.insertId });
});

exports.getSubmissionList = handler(async (req, res) => {
  const { offset, limit } = paginate(req);
  const visibility = req.can('submission.view.any') ? 'p.isPublic<6' : 'p.isPublic=1';

  // Only callers with cross-contest visibility can pass cid via queryAll; others are forced to cid=0.
  const restrictToNoContest = !req.body.queryAll || !req.can('contest.submission.view.cross');
  const cond = [
    restrictToNoContest ? ['s.cid=0'] : ['s.cid=?', req.body.cid],
    ['u.name=?', req.body.name],
    ['p.pid=?', req.body.pid],
    req.body.judgeRes != null ? ['s.judgeResult=?', req.body.judgeRes] : null,
    req.body.score != null ? ['s.score=?', req.body.score] : null,
    req.body.lang != null ? ['s.lang=?', req.body.lang] : null,
  ];
  const { where, params } = buildWhere(cond, visibility);

  const list = await db.query(
    'SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.codeLength,s.submitTime,s.cid,s.machine,s.lang,u.name,p.title,p.isPublic ' +
      'FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid' +
      `${where} ORDER BY sid DESC LIMIT ?,?`,
    [...params, offset, limit]
  );
  for (const r of list) formatSubmissionRow(r);

  const cnt = await db.one(
    'SELECT COUNT(*) as total FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid' +
      where,
    params
  );
  return ok(res, { total: cnt.total, data: list });
});

exports.getSubmissionInfo = handler(async (req, res) => {
  const { sid } = req.body;
  const visibility = req.can('submission.view.any') ? '' : ' AND p.isPublic=1';
  const row = await db.one(
    'SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.code,s.codeLength,s.submitTime,s.compileResult,s.caseResult,s.machine,s.lang,u.name,p.title,p.isPublic ' +
      'FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid ' +
      `WHERE sid=?${visibility} AND s.cid=0`,
    [sid]
  );
  if (!row) return fail(res, 'error');

  row.caseResult = JSON.parse(row.caseResult);
  row.singleCaseResult = await getCaseDetail(sid);
  row.singleCaseResult.sort((a, b) => a.caseId - b.caseId);
  row.done = false;

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
      subtaskInfo[c.subtaskId]['cases'].push(c);
    }
    row.subtaskInfo = subtaskInfo;
    row.done = true;
    delete row.caseResult;
    delete row.singleCaseResult;
  } else {
    for (const c of row.singleCaseResult) formatCaseRow(c);
  }
  formatSubmissionRow(row);
  return ok(res, { data: row });
});

exports.reJudge = [
  requirePermission('submission.rejudge'),
  handler(async (req, res) => {
    await exports.setSubmission(req.body.sid, 2, 0, 0, 0, null, null);
    pushSidIntoQueue(req.body.sid, true);
    await exports.clearCase(req.body.sid);
    return ok(res, { message: 'ok' });
  }),
];

exports.reJudgeProblem = [
  handler(async (req, res) => {
    const { pid } = req.body;
    const scope = { type: 'problem', id: Number(pid) };
    if (!req.can('submission.rejudge', scope) && !(await problemAuth(req, pid)).manage)
      return res.status(403).end('403 Forbidden');
    const list = await db.query('SELECT sid FROM submission WHERE pid=?', [pid]);
    for (const s of list) {
      exports.setSubmission(s.sid, 2, 0, 0, 0, null, null);
      pushSidIntoQueue(s.sid, true);
    }
    updateProblemStat(pid);
    exports.updateProblemSubmitInfo(pid);
    return ok(res, { message: 'ok', total: list.length });
  }),
];

exports.reJudgeContest = [
  handler(async (req, res) => {
    const cid = req.body.cid;
    const scope = { type: 'contest', id: Number(cid) };
    if (!req.can('submission.rejudge', scope)) {
      const c = await db.one('SELECT host FROM contest WHERE cid=?', [cid]);
      if (!c || (c.host !== req.session.uid && !req.can('contest.edit.any', scope)))
        return res.status(403).end('403 Forbidden');
    }
    const list = await db.query('SELECT sid FROM submission WHERE cid=?', [cid]);
    for (const s of list) {
      await exports.setSubmission(s.sid, 2, 0, 0, 0, null, null);
      pushSidIntoQueue(s.sid, true);
    }
    return ok(res, { message: 'ok', total: list.length });
  }),
];

exports.cancelSubmission = [
  requirePermission('submission.rejudge'),
  handler(async (req, res) => {
    const { sid } = req.body;
    await db.query('UPDATE submission SET judgeResult=13,score=0 WHERE sid=?', [sid]);
    const sub = await db.one('SELECT pid FROM submission WHERE sid=?', [sid]);
    if (sub) {
      exports.updateProblemSubmitInfo(sub.pid);
      updateProblemStat(sub.pid);
    }
    return ok(res, { message: 'ok' });
  }),
];

exports.getLangs = handler(async (req, res) => {
  const data = await db.query('SELECT id,des,lang FROM languages');
  const langList = data.reduce((acc, i) => {
    acc[i.id] = i;
    return acc;
  }, {});
  return ok(res, { data: langList });
});
