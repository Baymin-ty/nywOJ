const axios = require('axios');
const async = require('async');
const fs = require('fs');
const fsp = require('fs').promises;
const compressing = require('compressing');
const { EventEmitter } = require('events');
const { exec, fork } = require('child_process');
const path = require('path');
const db = require('../db');
const { handler, fail, ok, paginate, buildWhere } = require('../db/util');
const { Format, kbFormat } = require('../static');
const conf = require('../config.json');
const { getFile, setFile } = require('../file');
const { updateProblemStat, problemAuth, getProblemLang } = require('./problem');
const { judgeRes, formatSubmissionRow, formatCaseRow, isAnswerType } = require('../db/format');
const { readJudgeLogEntries } = require('./judgeLog');
const { getLanguage } = require('./judgeLanguages');

const ANSWER_SUBMIT_DIR = './answerSubmissions';
const ANSWER_TOTAL_LIMIT = 10 * 1024 * 1024; // 10MB combined

// ---- live progress bus ----
// SSE clients (web/src/components/submission/submissionView.vue) subscribe here
// to receive incremental updates while a submission is being judged. Judge
// workers run in forked child processes and bridge their progress through IPC
// (see judgeQueue + notifyProgress below).
const submissionEvents = new EventEmitter();
submissionEvents.setMaxListeners(0);
exports.submissionEvents = submissionEvents;

const isWorker = typeof process.send === 'function' && process.connected;
const notifyProgress = (sid) => {
  const id = Number(sid);
  if (!Number.isFinite(id) || id <= 0) return;
  if (isWorker) {
    try { process.send({ type: 'progress', sid: id }); } catch (e) { /* IPC closed */ }
  } else {
    submissionEvents.emit('update', id);
  }
};
exports.notifySubmissionProgress = notifyProgress;

// ---- judging queue ----
// Single unified worker handles every language; the worker reads
// submission.lang and dispatches via judgeLanguages.js. See judgeWorker.js.
const WORKER_PATH = path.join(__dirname, 'judgeWorker.js');
const judgeQueue = async.queue((submission, callback) => {
  const worker = fork(WORKER_PATH);
  worker.on('message', (msg) => {
    if (msg && msg.type === 'progress') {
      submissionEvents.emit('update', Number(msg.sid));
      return;
    }
    if (msg.type === 'done' || msg.type === 'error') {
      submissionEvents.emit('update', Number(msg.sid));
      worker.kill();
      callback();
    }
  });
  worker.on('error', (error) => {
    console.error(`Worker error for submission ${submission.sid}:`, error);
    submissionEvents.emit('update', Number(submission.sid));
    worker.kill();
    callback(error);
  });
  worker.send({ type: 'judge', sid: submission.sid, isreJudge: submission.isreJudge });
}, 4);

const machines = ['localhost'];
let taskId = 0;

const pushSidIntoQueue = async (sid, isreJudge) => {
  // Validate language is known up-front so the user gets a clear error here
  // instead of an opaque crash inside the forked worker. Answer-submission
  // submissions store lang=NULL and skip this check entirely; the worker
  // branches on problem.type and never reads a language config for them.
  const row = await db.one('SELECT s.lang FROM submission s WHERE s.sid=?', [sid]);
  if (!row) throw new Error(`submission ${sid} not found`);
  if (row.lang != null) {
    const lang = await db.one(
      'SELECT l.name FROM languages l INNER JOIN submission s ON l.id = s.lang WHERE s.sid=?',
      [sid]
    );
    if (!lang || !lang.name) throw new Error(`language not found for submission ${sid}`);
    if (!getLanguage(lang.name)) throw new Error(`language ${lang.name} has no judge config`);
  }

  if (conf.JUDGE.ISSERVER) {
    const machine = machines[++taskId % machines.length];
    if (machine === 'localhost') {
      console.log(Format(new Date()), 'server: localJudge', sid);
      judgeQueue.push({ sid, isreJudge });
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
    judgeQueue.push({ sid, isreJudge });
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
  ).then((r) => { notifyProgress(sid); return r.affectedRows; }).catch((err) => console.log(err));

exports.updateSubmissionDetail = (sid, caseId, input, output, time, memory, result, compareResult, subtaskId) =>
  db.query(
    'INSERT INTO submissionDetail(sid,caseId,input,output,time,memory,result,compareResult,subtaskId) values(?,?,?,?,?,?,?,?,?)',
    [sid, caseId, input, output, time, memory, result, compareResult, subtaskId]
  ).then((r) => { notifyProgress(sid); return r; }).catch((err) => console.log(err));

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
  db.query('DELETE FROM submissionDetail WHERE sid=?', [sid])
    .then((r) => { notifyProgress(sid); return r; })
    .catch((err) => console.log(err));

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
  const langId = parseInt(lang, 10);
  if (!pid) return fail(res, '请确认信息完善');
  const auth = await problemAuth(req, pid);
  if (!auth.view) return fail(res, '权限不足');
  if (code.length < 10) return fail(res, '代码太短');
  if (code.length > 1024 * 100) return fail(res, '选手提交的程序源文件必须不大于 100KB。');
  if (!Number.isSafeInteger(langId) || langId <= 0) return fail(res, '非法语言');

  const langRow = await db.one('SELECT name FROM languages WHERE id=?', [langId]);
  if (!langRow || !getLanguage(langRow.name)) return fail(res, '非法语言');

  const alang = await getProblemLang(pid);
  if (!((1 << langId) & alang)) return fail(res, '非法语言');

  const r = await db.query(
    'INSERT INTO submission(pid,uid,code,codelength,submitTime,lang) VALUES (?,?,?,?,?,?)',
    [pid, req.session.uid, code, code.length, new Date(), langId]
  );
  if (!r.affectedRows) return fail(res, 'error');

  await db.query('UPDATE problem SET submitCnt=submitCnt+1 WHERE pid=?', [pid]);
  pushSidIntoQueue(r.insertId, false);
  return ok(res, { sid: r.insertId });
});

exports.getSubmissionList = handler(async (req, res) => {
  const { offset, limit } = paginate(req);

  // Visibility for non-contest submissions:
  //   - submission.view.any / submission.view.notcontest → no filter
  //   - global problem.manage.any / problem.view.any → no filter
  //     (manager or view-collaborator on every problem)
  //   - otherwise: own submissions, public problems, problems the caller
  //     manages (owner+manage.self or manage.any scoped), AND problems the
  //     caller has scoped problem.view.any on (view-only collaborator —
  //     gets full submission visibility for that pid).
  // For the contest-side toggle (queryAll), only submission.view.any unlocks
  // cross-contest viewing — every other case forces s.cid=0.
  const canSeeAllNonContest =
    req.can('submission.view.any')
    || req.can('submission.view.notcontest')
    || req.can('problem.manage.any')
    || req.can('problem.view.any');

  let visibilityCond = null;
  if (!canSeeAllNonContest) {
    const me = req.session.uid || 0;
    const ownerClause = req.can('problem.manage.self') ? ' OR p.publisher=?' : '';
    const ownerParams = req.can('problem.manage.self') ? [me] : [];

    // Merge pids from BOTH scoped problem.manage.any and scoped problem.view.any
    // — view-only collaborators see this pid's submissions just like managers do.
    const scopedPids = new Set();
    const perms = req.perms;
    if (perms && perms.scoped) {
      for (const key of ['problem.manage.any', 'problem.view.any']) {
        const bucket = perms.scoped.get(key);
        if (!bucket) continue;
        for (const tag of bucket) {
          const m = /^problem:(\d+)$/.exec(tag);
          if (m) scopedPids.add(Number(m[1]));
        }
      }
    }
    const scopedIds = [...scopedPids];
    const scopedClause = scopedIds.length ? ` OR p.pid IN (${scopedIds.map(() => '?').join(',')})` : '';
    visibilityCond = [
      `(p.isPublic=1 OR s.uid=?${ownerClause}${scopedClause})`,
      me,
      ...ownerParams,
      ...scopedIds,
    ];
  }

  // Only submission.view.any unlocks cross-contest viewing in this list.
  const restrictToNoContest = !req.body.queryAll || !req.can('submission.view.any');
  const cond = [
    visibilityCond,
    restrictToNoContest ? ['s.cid=0'] : ['s.cid=?', req.body.cid],
    ['u.name=?', req.body.name],
    ['p.pid=?', req.body.pid],
    req.body.judgeRes != null ? ['s.judgeResult=?', req.body.judgeRes] : null,
    req.body.score != null ? ['s.score=?', req.body.score] : null,
    req.body.lang != null ? ['s.lang=?', req.body.lang] : null,
  ];
  const { where, params } = buildWhere(cond);

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

// Loads submission info + visibility check. Shared by getSubmissionInfo (POST,
// one-shot JSON) and streamSubmissionInfo (GET SSE, repeated on every progress
// event). Returns { data } on success, { status, message? } on failure so both
// callers can adapt to their response style.
const loadSubmissionInfo = async (req, sid) => {
  // Pre-fetch the row without visibility predicates; we re-check after we
  // know the problem id (so problem managers can view non-public submissions).
  const row = await db.one(
    'SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.code,s.codeLength,s.submitTime,s.compileResult,s.caseResult,s.machine,s.lang,u.name,p.title,p.isPublic ' +
      'FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid ' +
      `WHERE sid=? AND s.cid=0`,
    [sid]
  );
  if (!row) return { status: 202, message: 'error' };
  // Visibility (non-contest submission):
  //   - own submission                       → see
  //   - submission.view.any / .notcontest    → see
  //   - problemAuth(pid).view                → see
  //         covers public problem, owner, scoped/global problem.view.any, and
  //         anything that grants manage rights (which imply view).
  // problemAuth already merges all view paths so the route stays in one place.
  const auth = await problemAuth(req, row.pid);
  if (!auth.view
    && !req.can('submission.view.any')
    && !req.can('submission.view.notcontest')
    && row.uid !== req.session.uid) {
    return { status: 403 };
  }
  // canRejudge is computed once and returned to the client so the rejudge /
  // cancel buttons can render without a second permission round-trip.
  row.canRejudge =
    req.can('submission.rejudge.any')
    || auth.manage
    || (row.uid === req.session.uid && req.can('submission.rejudge.self'));

  row.caseResult = row.caseResult ? JSON.parse(row.caseResult) : null;
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
  row.judgeLog = await readJudgeLogEntries(sid);
  row.judgeLogRestricted = false;
  formatSubmissionRow(row);
  return { data: row };
};
exports.loadSubmissionInfo = loadSubmissionInfo;

exports.getSubmissionInfo = handler(async (req, res) => {
  const r = await loadSubmissionInfo(req, req.body.sid);
  if (r.status === 403) return res.status(403).end('403 Forbidden');
  if (r.status) return fail(res, r.message || 'error', r.status);
  return ok(res, { data: r.data });
});

exports.getSubmissionLog = handler(async (req, res) => {
  const sid = parseInt(req.body.sid, 10);
  if (!sid) return fail(res, 'bad sid');
  const r = await loadSubmissionInfo(req, sid);
  if (r.status === 403) return res.status(403).end('403 Forbidden');
  if (r.status) return fail(res, r.message || 'error', r.status);
  const entries = await readJudgeLogEntries(sid);
  return ok(res, { data: { entries, restricted: false } });
});

// ---- SSE bridge ----
// Generic helper used by both judge and contest stream endpoints. The loader
// runs the same visibility check as the POST sibling, and we re-run it on
// every progress event so the client sees a consistent view of state.
//
// Coalescing: while one loader call is in flight, additional events flip a
// `dirty` flag instead of stacking — once the in-flight call resolves we run
// one more pass. Cheap, and keeps the DB from being hammered when many cases
// finish in quick succession.
const streamSubmission = async (req, res, loader, rawSid) => {
  const sid = parseInt(rawSid, 10);
  if (!sid) return res.status(400).end('bad sid');

  let initial;
  try {
    initial = await loader(req, sid);
  } catch (err) {
    console.error('SSE initial load err:', err);
    return res.status(202).send({ message: 'error' });
  }
  if (initial.status === 403) return res.status(403).end('403 Forbidden');
  if (initial.status) return fail(res, initial.message || 'error', initial.status);

  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let closed = false;
  const send = (event, payload) => {
    if (closed) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send('snapshot', initial.data);

  let busy = false;
  let dirty = false;
  const refresh = async () => {
    if (closed) return;
    if (busy) { dirty = true; return; }
    busy = true;
    try {
      const r = await loader(req, sid);
      if (closed) return;
      if (r.data) send('update', r.data);
    } catch (err) {
      console.error('SSE refresh err:', err);
    } finally {
      busy = false;
      if (dirty && !closed) {
        dirty = false;
        refresh();
      }
    }
  };

  const onUpdate = (eventSid) => {
    if (eventSid === sid) refresh();
  };
  submissionEvents.on('update', onUpdate);

  // Heartbeat every 25s keeps proxies (nginx default 60s idle) from killing
  // the stream when the submission is sitting in queue.
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': hb\n\n');
  }, 25000);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    submissionEvents.off('update', onUpdate);
    try { res.end(); } catch (e) { /* already ended */ }
  };

  req.on('close', cleanup);
  req.on('aborted', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
};
exports.streamSubmission = streamSubmission;

exports.streamSubmissionInfo = (req, res) =>
  streamSubmission(req, res, loadSubmissionInfo, req.query.sid);

const canManageContestById = async (req, cid) => {
  if (!cid) return false;
  const row = await db.one('SELECT host FROM contest WHERE cid=?', [cid]);
  if (!row) return false;
  const isHost = row.host === req.session.uid;
  if (isHost && req.can('contest.manage.self')) return true;
  return req.can('contest.manage.any', { type: 'contest', id: Number(cid) });
};

// Rejudge authorization (single submission):
//   - submission.rejudge.any            → any submission
//   - contest manager (manage.any/self) → submissions inside that contest
//   - problem manager (manage.any/self) → non-contest submissions of that problem
//   - submission.rejudge.self           → own non-contest submissions only
const canRejudgeSubmission = async (req, sid) => {
  if (req.can('submission.rejudge.any')) return true;
  const sub = await db.one('SELECT cid, pid, uid FROM submission WHERE sid=?', [sid]);
  if (!sub) return false;
  if (sub.cid) {
    return canManageContestById(req, sub.cid);
  }
  if (sub.uid === req.session.uid && req.can('submission.rejudge.self')) return true;
  return (await problemAuth(req, sub.pid)).manage;
};

const requireRejudgePermission = async (req, res, next) => {
  try {
    const sid = parseInt(req.body.sid, 10);
    if (!sid) return fail(res, '请确认信息完善');
    const allowed = await canRejudgeSubmission(req, sid);
    if (!allowed) return res.status(403).end('403 Forbidden');
    return next();
  } catch (err) {
    return next(err);
  }
};
requireRejudgePermission.permissionKey = 'submission.rejudge.any';

exports.reJudge = [
  requireRejudgePermission,
  handler(async (req, res) => {
    await exports.setSubmission(req.body.sid, 2, 0, 0, 0, null, null);
    pushSidIntoQueue(req.body.sid, true);
    await exports.clearCase(req.body.sid);
    return ok(res, { message: 'ok' });
  }),
];

// Batch rejudge:
// - Accepts { sids: number[] }
// - Each sid is authorized via canRejudgeSubmission (same as single reJudge)
// - Returns { total, accepted, denied: [{ sid, reason }] }
exports.reJudgeBatch = [
  handler(async (req, res) => {
    const raw = req.body && req.body.sids;
    if (!Array.isArray(raw)) return fail(res, 'bad sids');
    const sids = raw
      .map((x) => parseInt(x, 10))
      .filter((x) => Number.isFinite(x) && x > 0);
    if (!sids.length) return ok(res, { total: 0, accepted: 0, denied: [] });

    // soft limit to avoid accidental huge fan-out
    if (sids.length > 200) return fail(res, '一次最多批量重测 200 条提交');

    const denied = [];
    let accepted = 0;
    for (const sid of sids) {
      const allowed = await canRejudgeSubmission(req, sid);
      if (!allowed) {
        denied.push({ sid, reason: '权限不足' });
        continue;
      }
      await exports.setSubmission(sid, 2, 0, 0, 0, null, null);
      pushSidIntoQueue(sid, true);
      await exports.clearCase(sid);
      accepted += 1;
    }
    return ok(res, { total: sids.length, accepted, denied });
  }),
];

exports.reJudgeProblem = [
  handler(async (req, res) => {
    const { pid } = req.body;
    if (!req.can('submission.rejudge.any') && !(await problemAuth(req, pid)).manage)
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
    if (!req.can('submission.rejudge.any') && !(await canManageContestById(req, cid))) {
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
  requireRejudgePermission,
  handler(async (req, res) => {
    const { sid } = req.body;
    await db.query('UPDATE submission SET judgeResult=13,score=0 WHERE sid=?', [sid]);
    notifyProgress(sid);
    const sub = await db.one('SELECT pid FROM submission WHERE sid=?', [sid]);
    if (sub) {
      exports.updateProblemSubmitInfo(sub.pid);
      updateProblemStat(sub.pid);
    }
    return ok(res, { message: 'ok' });
  }),
];

exports.getLangs = handler(async (req, res) => {
  const data = await db.query('SELECT id,name,des,lang FROM languages');
  const langList = data.filter((i) => getLanguage(i.name)).reduce((acc, i) => {
    const { name, ...payload } = i;
    acc[i.id] = payload;
    return acc;
  }, {});
  return ok(res, { data: langList });
});

// ---- submit-answer (problem.type ∈ {2,3}) ----
//
// Accepts a JSON payload of textarea answers via `answers` (object keyed by
// case name) and/or a zip file (multer single 'file') whose entries match
// `{case.name}.out`. We dedupe by case.name — zip wins over textarea if both
// supply the same case. User-submitted answers land in
// `./answerSubmissions/{sid}/{case.name}.out`; judgeWorker.judgeAnswer reads
// them back when judging.
const stripOut = (n) => (n.endsWith('.out') ? n.slice(0, -4) : n);

const extractZipAnswers = (zipPath, caseNames) =>
  new Promise((resolve, reject) => {
    const out = {};
    const stream = new compressing.zip.UncompressStream({ source: zipPath });
    stream
      .on('error', reject)
      .on('finish', () => resolve(out))
      .on('entry', (header, entryStream, next) => {
        if (header.type !== 'file') {
          entryStream.resume();
          return next();
        }
        // Match by basename to tolerate users zipping a folder containing
        // the .out files (common with macOS Finder).
        const base = path.basename(header.name);
        const name = stripOut(base);
        if (!caseNames.has(name)) {
          entryStream.resume();
          return next();
        }
        const chunks = [];
        let size = 0;
        entryStream.on('data', (c) => {
          chunks.push(c);
          size += c.length;
          if (size > ANSWER_TOTAL_LIMIT) {
            stream.destroy(new Error('单个答案超过 10MB 限制'));
          }
        });
        entryStream.on('end', () => {
          out[name] = Buffer.concat(chunks).toString('utf-8');
          next();
        });
        entryStream.on('error', reject);
      });
  });

exports.submitAnswer = handler(async (req, res) => {
  const cleanupZip = async () => {
    if (req.file && req.file.path) {
      try { await fsp.unlink(req.file.path); } catch (_) { /* best effort */ }
    }
  };
  try {
    // multer puts text fields into req.body even on multipart; pid may arrive
    // as a string here.
    const pid = parseInt(req.body.pid, 10);
    if (!pid) { await cleanupZip(); return fail(res, '请确认信息完善'); }
    const auth = await problemAuth(req, pid);
    if (!auth.view) { await cleanupZip(); return fail(res, '权限不足'); }

    const pinfo = await db.one('SELECT type FROM problem WHERE pid=?', [pid]);
    if (!pinfo) { await cleanupZip(); return fail(res, '题目不存在'); }
    if (!isAnswerType(pinfo.type)) {
      await cleanupZip();
      return fail(res, '该题不是提交答案题');
    }

    const cfgRaw = await getFile(`./data/${pid}/config.json`);
    if (!cfgRaw) { await cleanupZip(); return fail(res, '题目尚未配置测试点'); }
    const cfg = JSON.parse(cfgRaw);
    const cases = cfg.cases || [];
    // case "name" = the .in filename without extension; ZIP entries match
    // `{name}.out`, textarea keys also use this name.
    const caseNames = new Set();
    for (const c of cases) {
      const n = c.input ? c.input.replace(/\.in$/, '') : String(c.index);
      caseNames.add(n);
    }

    const answers = {};

    // 1) textarea / JSON input — keys must match a known case name
    if (req.body.answers) {
      let parsed;
      try {
        parsed = typeof req.body.answers === 'string'
          ? JSON.parse(req.body.answers)
          : req.body.answers;
      } catch (e) {
        await cleanupZip();
        return fail(res, 'answers 字段格式错误');
      }
      if (parsed && typeof parsed === 'object') {
        for (const k of Object.keys(parsed)) {
          if (!caseNames.has(k)) continue;
          const v = parsed[k];
          if (v == null) continue;
          const s = String(v);
          if (s.length === 0) continue;
          answers[k] = s;
        }
      }
    }

    // 2) ZIP overrides textarea on conflict
    if (req.file && req.file.path) {
      let zipAnswers = {};
      try {
        zipAnswers = await extractZipAnswers(req.file.path, caseNames);
      } catch (e) {
        await cleanupZip();
        return fail(res, 'ZIP 解析失败: ' + (e.message || e));
      }
      for (const k of Object.keys(zipAnswers)) {
        answers[k] = zipAnswers[k];
      }
    }

    if (!Object.keys(answers).length) {
      await cleanupZip();
      return fail(res, '请上传或输入至少一个测试点的答案');
    }

    let totalSize = 0;
    for (const k of Object.keys(answers)) totalSize += Buffer.byteLength(answers[k], 'utf-8');
    if (totalSize > ANSWER_TOTAL_LIMIT) {
      await cleanupZip();
      return fail(res, '答案总大小超过 10MB');
    }

    const r = await db.query(
      'INSERT INTO submission(pid,uid,code,codelength,submitTime,lang) VALUES (?,?,?,?,?,?)',
      [pid, req.session.uid, '', totalSize, new Date(), null]
    );
    if (!r.affectedRows) { await cleanupZip(); return fail(res, 'error'); }
    const sid = r.insertId;

    const dir = path.join(__dirname, '..', ANSWER_SUBMIT_DIR, String(sid));
    await fsp.mkdir(dir, { recursive: true });
    for (const [name, content] of Object.entries(answers)) {
      await fsp.writeFile(path.join(dir, `${name}.out`), content);
    }
    await cleanupZip();

    await db.query('UPDATE problem SET submitCnt=submitCnt+1 WHERE pid=?', [pid]);
    pushSidIntoQueue(sid, false);
    return ok(res, { sid });
  } catch (err) {
    await cleanupZip();
    console.error('submitAnswer err:', err);
    return fail(res, err.message || '提交失败');
  }
});

// Return the user's submitted answer for a single case in an answer-submission.
// Caller may identify the case by its `name` (the case.input basename without
// extension) OR by `caseId` (the integer case.index from config.json); the
// submission detail view only has caseId, so we resolve via config.json when
// needed. Auth mirrors the submission detail visibility (own submission, or
// view-collaborator / submission.view.any). Capped at 256KB per case.
exports.getAnswerFile = handler(async (req, res) => {
  const sid = parseInt(req.body.sid, 10);
  if (!sid) return fail(res, '参数非法');
  let name = req.body.name != null ? String(req.body.name) : '';
  const caseId = req.body.caseId != null ? parseInt(req.body.caseId, 10) : NaN;
  if (!name && !Number.isFinite(caseId)) return fail(res, '参数非法');
  if (name && /[\/\\]/.test(name)) return fail(res, '参数非法');

  const row = await db.one('SELECT pid,uid,lang FROM submission WHERE sid=?', [sid]);
  if (!row) return fail(res, '提交不存在');
  if (row.lang != null) return fail(res, '该提交不是答案题');
  const auth = await problemAuth(req, row.pid);
  const ownSelf = row.uid === req.session.uid;
  const allowed =
    ownSelf
    || auth.view
    || req.can('submission.view.any')
    || req.can('submission.view.notcontest');
  if (!allowed) return res.status(403).end('403 Forbidden');

  if (!name) {
    const cfgRaw = await getFile(`./data/${row.pid}/config.json`);
    if (!cfgRaw) return fail(res, '题目未配置');
    const cfg = JSON.parse(cfgRaw);
    const hit = (cfg.cases || []).find((c) => c.index === caseId);
    if (!hit) return fail(res, '测试点不存在');
    name = hit.input ? hit.input.replace(/\.in$/, '') : String(hit.index);
  }

  const filePath = path.join(__dirname, '..', ANSWER_SUBMIT_DIR, String(sid), `${name}.out`);
  if (!fs.existsSync(filePath)) return ok(res, { name, content: '', missing: true, size: 0 });
  const stat = fs.statSync(filePath);
  const MAX = 256 * 1024;
  const truncated = stat.size > MAX;
  const fd = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(Math.min(stat.size, MAX));
    await fd.read(buf, 0, buf.length, 0);
    return ok(res, { name, content: buf.toString('utf-8'), truncated, size: stat.size });
  } finally {
    await fd.close();
  }
});
