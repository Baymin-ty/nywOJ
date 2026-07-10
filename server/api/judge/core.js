const axios = require('axios');
const async = require('async');
const fs = require('fs');
const fsp = require('fs').promises;
const compressing = require('compressing');
const { execFile, fork } = require('child_process');
const path = require('path');
const os = require('os');
const db = require('../../db');
const { handler, fail, ok, paginate, buildWhere } = require('../../db/util');
const { Format, kbFormat } = require('../../static');
const conf = require('../../config.json');
const { getFile } = require('../../file');
const storage = require('../../storage');
const { updateProblemStat, problemAuth, getProblemLang } = require('../problem/core');
const { judgeRes, formatSubmissionRow, formatCaseRow, isAnswerType } = require('../../db/format');
const { readJudgeLogEntries } = require('./log');
const { getLanguage, syncLanguages } = require('./languages');
const judgeClients = require('./clientRegistry');
const { submissionEvents, notifySubmissionProgress } = require('./events');

// 增量刷新比赛榜单缓存（主进程 judgeQueue 回调 / 提交入队）。懒加载避免
// 与 contest 模块的加载序耦合；fire-and-forget，绝不影响判题主流程。
const standingsApplyEvent = (sid) => {
  try {
    const { applyEventBySid } = require('../contest/standings');
    Promise.resolve(applyEventBySid(sid)).catch(() => {});
  } catch (e) { /* 榜单模块不可用时忽略 */ }
};

const ANSWER_SUBMIT_DIR = './answerSubmissions';
const ANSWER_TOTAL_LIMIT = 10 * 1024 * 1024; // 10MB combined
const SUBMISSION_STAT_TOP = 100;
const SERVER_ROOT = path.join(__dirname, '..', '..');

const STAT_TYPES = {
  Fastest: { field: 'time', order: 'ASC', label: '最快通过' },
  MinMemory: { field: 'memory', order: 'ASC', label: '最低内存' },
  MinAnswerSize: { field: 'codeLength', order: 'ASC', label: '最短代码' },
  Earliest: { field: 'submitTime', order: 'ASC', label: '最早通过' },
};
const PENDING_JUDGE_RESULTS = new Set([0, 1, 2]);

const allowRemoteSandboxClients = () =>
  !!(conf.JUDGE && (
    conf.JUDGE.ALLOW_REMOTE_SANDBOX_CLIENTS === true ||
    conf.JUDGE.ALLOW_REMOTE_SANDBOX_CLIENTS === 1 ||
    conf.JUDGE.ALLOW_REMOTE_SANDBOX_CLIENTS === '1'
  ));

const normalizeStatType = (value) => {
  const raw = String(value || 'Fastest').trim().toLowerCase();
  return {
    fastest: 'Fastest',
    time: 'Fastest',
    minmemory: 'MinMemory',
    memory: 'MinMemory',
    minanswersize: 'MinAnswerSize',
    shortest: 'MinAnswerSize',
    codelength: 'MinAnswerSize',
    earliest: 'Earliest',
  }[raw] || (STAT_TYPES[value] ? value : null);
};

let submissionSchemaReady = null;
const ensureSubmissionSchema = () => {
  if (!submissionSchemaReady) {
    submissionSchemaReady = (async () => {
      const col = await db.one(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='submission' AND COLUMN_NAME='isPublic'`
      );
      if (!col || !col.cnt) {
        await db.query('ALTER TABLE submission ADD COLUMN isPublic TINYINT NOT NULL DEFAULT 1');
      }
      await db.query(`
        CREATE TABLE IF NOT EXISTS submissionFile (
          id      INT AUTO_INCREMENT PRIMARY KEY,
          sid     INT NOT NULL,
          fileKey VARCHAR(64) NOT NULL,
          lang    INT NULL,
          content LONGTEXT NULL,
          KEY idx_sid (sid)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    })();
  }
  return submissionSchemaReady;
};

const problemPublicOf = async (pid) => {
  const row = await db.one('SELECT isPublic FROM problem WHERE pid=?', [pid]);
  return row && row.isPublic ? 1 : 0;
};

// Shared flow summary (judgeProfile.js): preset/submitMode/pipeGroupCount/
// interactive plus compile/steps structure for the submission-page pipeline view.
const { summarizeProfileFlow: summarizeJudgeProfile } = require('../problem/judgeProfile');

const answerSubmitDirOf = (sid) => path.join(__dirname, '..', '..', ANSWER_SUBMIT_DIR, String(sid));
const judgeLogPathOf = (sid) => path.join(__dirname, '..', '..', 'judge_logs', `${sid}.log`);

// ---- live progress bus ----
// SSE clients (web/src/components/submission/submissionView.vue) subscribe here
// to receive incremental updates while a submission is being judged. Judge
// workers run in forked child processes and bridge their progress through IPC
// (see judgeQueue + notifyProgress below).
exports.submissionEvents = submissionEvents;
const notifyProgress = notifySubmissionProgress;
exports.notifySubmissionProgress = notifyProgress;

// ---- judging queue ----
// Single unified worker handles every language; the worker reads
// submission.lang and dispatches through the language registry.
const WORKER_PATH = path.join(__dirname, 'worker.js');
const judgeQueue = async.queue((submission, callback) => {
  const worker = fork(WORKER_PATH);
  worker.on('message', (msg) => {
    if (msg && msg.type === 'progress') {
      submissionEvents.emit('update', Number(msg.sid));
      return;
    }
    if (msg.type === 'done' || msg.type === 'error') {
      submissionEvents.emit('update', Number(msg.sid));
      standingsApplyEvent(Number(msg.sid)); // 增量刷新比赛榜单缓存（主进程）
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

exports.getJudgeQueueStats = () => ({
  concurrency: judgeQueue.concurrency,
  waiting: typeof judgeQueue.length === 'function' ? judgeQueue.length() : 0,
  running: typeof judgeQueue.running === 'function' ? judgeQueue.running() : 0,
  idle: typeof judgeQueue.idle === 'function' ? judgeQueue.idle() : false,
});

let taskId = 0;

const pushLocalJudge = (sid, isreJudge) => {
  console.log(Format(new Date()), 'server: localJudge', sid);
  standingsApplyEvent(sid); // 入队即把 pending 事件并进榜单缓存（ACM/CF pending 显示）
  judgeQueue.push({ sid, isreJudge });
};
exports.pushLocalJudge = pushLocalJudge;

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
    const remoteDispatchEnabled = allowRemoteSandboxClients();
    const remoteClients = remoteDispatchEnabled
      ? await judgeClients.getDispatchClients().catch((err) => {
        console.log(Format(new Date()), 'server: judge client registry unavailable:', err.message);
        return [];
      })
      : [];
    const targets = [{ local: true, name: 'localhost' }, ...remoteClients];
    const target = targets[++taskId % targets.length];
    if (target.local) return pushLocalJudge(sid, isreJudge);

    console.log(Format(new Date()), 'server: task assigned to', target.name, target.endpoint, sid);
    try {
      const r = await axios.post(
        target.endpoint,
        { sid, isreJudge, clientKey: target.clientKey, serverName: conf.JUDGE.NAME },
        { timeout: conf.JUDGE.CLIENT_TIMEOUT || 10000 }
      );
      if (r.status === 200) {
        await judgeClients.recordDispatch(target.id, {
          status: 'ok',
          message: 'task accepted',
          sid,
          queue: r.data && r.data.queue,
        });
        console.log(Format(new Date()), 'server:', target.name, 'ok', sid);
      } else {
        await judgeClients.recordDispatch(target.id, {
          status: 'error',
          message: `status ${r.status}`,
          sid,
        });
        console.log(Format(new Date()), 'server:', target.name, 'error: status not 200', r.status, sid);
        pushLocalJudge(sid, isreJudge);
      }
    } catch (err) {
      await judgeClients.recordDispatch(target.id, {
        status: 'error',
        message: err && err.message ? err.message : String(err),
        sid,
      });
      console.log(Format(new Date()), 'server:', target.name, 'error:', err.message || err, sid);
      pushLocalJudge(sid, isreJudge);
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
    execFile('./comparer/comparer', ['./comparer/data.in', `${fileSuf}usr.out`, `${fileSuf}data.out`], { cwd: SERVER_ROOT }, (err, stdout, stderr) => {
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

const refreshProblemJudgeStats = async (pid) => {
  if (!pid) return;
  await exports.updateProblemSubmitInfo(pid);
  await updateProblemStat(pid);
};

const resetAndQueueRejudge = async (sid) => {
  const sub = await db.one('SELECT pid FROM submission WHERE sid=?', [sid]);
  await exports.setSubmission(sid, 2, 0, 0, 0, null, null);
  await exports.clearCase(sid);
  await pushSidIntoQueue(sid, true);
  return sub && sub.pid;
};

exports.updateData = async (pid) => {
  if (storage.isRemote()) {
    await storage.restoreProblemData(pid, path.join(__dirname, '..', '..', 'data', String(pid)));
    return 'object-storage';
  }
  return new Promise((resolve) => {
    execFile('./sync_data.sh', [String(pid)], { cwd: SERVER_ROOT }, (err, stdout) => resolve(stdout));
  });
};

const getCaseDetail = (sid) => db.query('SELECT * FROM submissionDetail WHERE sid=?', [sid]);

// ---- handlers ----
exports.receiveTask = handler(async (req, res) => {
  if (conf.JUDGE.ISSERVER) return fail(res, 'This is SERVER');
  const requiredKey = conf.JUDGE.CLIENT_KEY || conf.JUDGE.KEY || '';
  if (requiredKey && req.body.clientKey !== requiredKey) return fail(res, 'Invalid judge client key', 403);
  await pushSidIntoQueue(req.body.sid, req.body.isreJudge);
  return ok(res, { message: 'ok', machine: conf.JUDGE.NAME, queue: exports.getJudgeQueueStats() });
});

exports.clientHeartbeat = handler(async (req, res) => {
  if (!conf.JUDGE.ISSERVER) return fail(res, 'This is CLIENT');
  const client = await judgeClients.getByKey(req.body.clientKey);
  if (!client) return fail(res, 'Invalid judge client key', 403);
  await judgeClients.recordHeartbeat(client.id, {
    status: req.body.status || 'online',
    message: req.body.message || '',
    queue: req.body.queue,
  });
  return ok(res, { message: 'ok' });
});

exports.submit = handler(async (req, res) => {
  await ensureSubmissionSchema();
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

  const isPublic = await problemPublicOf(pid);
  const r = await db.query(
    'INSERT INTO submission(pid,uid,code,codelength,submitTime,lang,isPublic) VALUES (?,?,?,?,?,?,?)',
    [pid, req.session.uid, code, code.length, new Date(), langId, isPublic]
  );
  if (!r.affectedRows) return fail(res, 'error');

  await db.query('UPDATE problem SET submitCnt=submitCnt+1 WHERE pid=?', [pid]);
  pushSidIntoQueue(r.insertId, false);
  return ok(res, { sid: r.insertId });
});

// Multi-slot submission for profile problems (decision: 主文件 + 附加槽).
// `files` is an array aligned to profile.submit.files. The first source slot is
// the primary → submission.code/lang; every other named source/file slot lands
// in submissionFile (file slots store textual content with lang=NULL).
exports.submitMulti = handler(async (req, res) => {
  await ensureSubmissionSchema();
  const { pid } = req.body;
  const langId = parseInt(req.body.lang, 10);
  const files = req.body.files;
  if (!pid) return fail(res, '请确认信息完善');
  const auth = await problemAuth(req, pid);
  if (!auth.view) return fail(res, '权限不足');
  if (!Array.isArray(files)) return fail(res, '提交格式错误');

  const prow = await db.one('SELECT judgeProfile FROM problem WHERE pid=?', [pid]);
  if (!prow || !prow.judgeProfile) return fail(res, '该题未配置评测流程');
  let profile;
  try { profile = JSON.parse(prow.judgeProfile); } catch (_) { return fail(res, '题目配置损坏'); }
  const slots = ((profile.submit && profile.submit.files) || [])
    .filter((f) => f && (f.kind === 'source' || f.kind === 'file'));
  const primaryIndex = slots.findIndex((f) => f.kind === 'source');
  if (primaryIndex < 0) return fail(res, '该题无代码提交槽');

  if (!Number.isSafeInteger(langId) || langId <= 0) return fail(res, '非法语言');
  const langRow = await db.one('SELECT name FROM languages WHERE id=?', [langId]);
  if (!langRow || !getLanguage(langRow.name)) return fail(res, '非法语言');
  if (!((1 << langId) & (await getProblemLang(pid)))) return fail(res, '非法语言');

  const HARD_MAX = 1024 * 100;
  const collected = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const content = files[i];
    if (typeof content !== 'string' || content.length < 1) {
      if (slot.optional) { collected.push(null); continue; }
      return fail(res, `请填写文件「${slot.label || slot.name || ('文件' + (i + 1))}」`);
    }
    const cap = Math.min((slot.maxKB || 100) * 1024, HARD_MAX);
    if (Buffer.byteLength(content, 'utf-8') > cap) return fail(res, `文件「${slot.label || slot.name || ('文件' + (i + 1))}」超出大小限制`);
    if (i !== primaryIndex && !slot.name) return fail(res, '附加文件槽缺少文件名，无法提交');
    collected.push({ slot, content });
  }
  const primary = collected[primaryIndex];
  if (!primary) return fail(res, '请至少提交主文件');

  const totalLen = collected.reduce((a, c) => a + (c ? Buffer.byteLength(c.content, 'utf-8') : 0), 0);
  const isPublic = await problemPublicOf(pid);
  const r = await db.query(
    'INSERT INTO submission(pid,uid,code,codelength,submitTime,lang,isPublic) VALUES (?,?,?,?,?,?,?)',
    [pid, req.session.uid, primary.content, totalLen, new Date(), langId, isPublic]
  );
  if (!r.affectedRows) return fail(res, 'error');
  const sid = r.insertId;
  for (let i = 0; i < collected.length; i++) {
    if (i === primaryIndex) continue;
    if (!collected[i]) continue;
    await db.query(
      'INSERT INTO submissionFile(sid,fileKey,lang,content) VALUES (?,?,?,?)',
      [sid, collected[i].slot.name, collected[i].slot.kind === 'source' ? langId : null, collected[i].content]
    );
  }
  await db.query('UPDATE problem SET submitCnt=submitCnt+1 WHERE pid=?', [pid]);
  pushSidIntoQueue(sid, false);
  return ok(res, { sid });
});

exports.getSubmissionList = handler(async (req, res) => {
  await ensureSubmissionSchema();
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
      `((s.isPublic=1 AND p.isPublic=1) OR s.uid=?${ownerClause}${scopedClause})`,
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
    'SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.codeLength,s.submitTime,s.cid,s.machine,s.lang,s.isPublic,u.name,p.title,p.isPublic AS problemPublic ' +
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
  await ensureSubmissionSchema();
  // Pre-fetch the row without visibility predicates; we re-check after we
  // know the problem id (so problem managers can view non-public submissions).
  const row = await db.one(
    'SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.code,s.codeLength,s.submitTime,s.compileResult,s.caseResult,s.machine,s.lang,s.isPublic,l.name AS langName,u.name,p.title,p.isPublic AS problemPublic,p.judgeProfile AS problemJudgeProfile ' +
      'FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid ' +
      'LEFT JOIN languages l ON l.id=s.lang ' +
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
  const publicVisible = !!row.isPublic;
  if (!publicVisible
    && !auth.view
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
  row.canSetPublic = req.can('submission.manage.any') || auth.manage;
  row.canDelete = row.canSetPublic;
  row.canDownload = true;
  row.sourceFiles = await loadSubmissionSourceFiles(row);
  row.judgeProfileSummary = summarizeJudgeProfile(row.problemJudgeProfile);
  delete row.problemJudgeProfile;

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

exports.querySubmissionStatistics = handler(async (req, res) => {
  await ensureSubmissionSchema();
  const pid = Number(req.body.problemId || req.body.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0) return fail(res, '题目编号非法');
  const type = normalizeStatType(req.body.statisticsType || req.body.type);
  if (!type) return fail(res, '统计类型非法');
  if (!(await problemAuth(req, pid)).view) return fail(res, '权限不足');

  const problem = await db.one('SELECT pid,title,type FROM problem WHERE pid=?', [pid]);
  if (!problem) return fail(res, '题目不存在');
  if (isAnswerType(problem.type)) return fail(res, '该题型不支持提交统计榜');

  const pageSize = Math.min(Number(req.body.pageSize || req.body.takeCount || 20) || 20, 50);
  const pageId = Math.max(Number(req.body.pageId || 1) || 1, 1);
  const offset = Math.max((pageId - 1) * pageSize, Number(req.body.skipCount || 0) || 0);
  const { field, order, label } = STAT_TYPES[type];
  const limitedOffset = Math.min(offset, SUBMISSION_STAT_TOP);
  const limitedCount = Math.max(0, Math.min(pageSize, SUBMISSION_STAT_TOP - limitedOffset));

  const scoreRows = await db.query(
    'SELECT score,COUNT(*) AS cnt FROM submission WHERE pid=? AND score IS NOT NULL GROUP BY score',
    [pid]
  );
  const scores = new Array(101).fill(0);
  for (const row of scoreRows) {
    const score = Number(row.score);
    if (Number.isInteger(score) && score >= 0 && score <= 100) scores[score] = Number(row.cnt) || 0;
  }

  const acceptedUsers = await db.one(
    'SELECT COUNT(DISTINCT uid) AS total FROM submission WHERE pid=? AND cid=0 AND judgeResult=4',
    [pid]
  );
  const total = Math.min(Number(acceptedUsers && acceptedUsers.total) || 0, SUBMISSION_STAT_TOP);
  let list = [];
  if (limitedCount > 0) {
    const ranked = await db.query(
      `SELECT MIN(s.sid) AS sid,best.fieldValue
         FROM submission s
         INNER JOIN (
           SELECT uid,MIN(${field}) AS fieldValue
             FROM submission
            WHERE pid=? AND cid=0 AND judgeResult=4 AND ${field} IS NOT NULL
            GROUP BY uid
            ORDER BY fieldValue ${order}
            LIMIT ${SUBMISSION_STAT_TOP}
         ) best ON best.uid=s.uid AND s.${field}=best.fieldValue
        WHERE s.pid=? AND s.cid=0 AND s.judgeResult=4
        GROUP BY s.uid,best.fieldValue
        ORDER BY best.fieldValue ${order},sid ASC
        LIMIT ?,?`,
      [pid, pid, limitedOffset, limitedCount]
    );
    const ids = ranked.map((row) => Number(row.sid)).filter(Boolean);
    if (ids.length) {
      const rows = await db.query(
        'SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.codeLength,s.submitTime,s.cid,s.machine,s.lang,s.isPublic,u.name,p.title,p.isPublic AS problemPublic ' +
          'FROM submission s INNER JOIN userInfo u ON u.uid=s.uid INNER JOIN problem p ON p.pid=s.pid ' +
          `WHERE s.sid IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      const byId = new Map(rows.map((row) => [Number(row.sid), row]));
      list = ids.map((id, i) => ({ ...byId.get(id), fieldValue: ranked[i].fieldValue })).filter((row) => row.sid);
    }
    for (let i = 0; i < list.length; i++) {
      list[i].rank = limitedOffset + i + 1;
      list[i].metric = type;
      list[i].metricValue = list[i].fieldValue;
      delete list[i].fieldValue;
      formatSubmissionRow(list[i]);
    }
  }

  return ok(res, {
    data: list,
    submissions: list,
    total,
    count: total,
    pageId,
    pageSize,
    topLimit: SUBMISSION_STAT_TOP,
    scores,
    problem: {
      pid: problem.pid,
      title: problem.title,
      type: problem.type,
    },
    statisticsType: type,
    label,
  });
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
    const pid = await resetAndQueueRejudge(req.body.sid);
    await refreshProblemJudgeStats(pid);
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
    const affectedPids = new Set();
    for (const sid of sids) {
      const allowed = await canRejudgeSubmission(req, sid);
      if (!allowed) {
        denied.push({ sid, reason: '权限不足' });
        continue;
      }
      const pid = await resetAndQueueRejudge(sid);
      if (pid) affectedPids.add(Number(pid));
      accepted += 1;
    }
    for (const pid of affectedPids) await refreshProblemJudgeStats(pid);
    return ok(res, { total: sids.length, accepted, denied });
  }),
];

exports.reJudgeProblem = [
  handler(async (req, res) => {
    const { pid } = req.body;
    const canRejudgeAny = req.can('submission.rejudge.any');
    if (!canRejudgeAny && !(await problemAuth(req, pid)).manage)
      return res.status(403).end('403 Forbidden');
    const list = await db.query(
      `SELECT sid FROM submission WHERE pid=?${canRejudgeAny ? '' : ' AND cid=0'}`,
      [pid]
    );
    for (const s of list) {
      await resetAndQueueRejudge(s.sid);
    }
    await refreshProblemJudgeStats(pid);
    return ok(res, { message: 'ok', total: list.length });
  }),
];

exports.reJudgeContest = [
  handler(async (req, res) => {
    const cid = req.body.cid;
    if (!req.can('submission.rejudge.any') && !(await canManageContestById(req, cid))) {
      return res.status(403).end('403 Forbidden');
    }
    const list = await db.query('SELECT sid,pid FROM submission WHERE cid=?', [cid]);
    const affectedPids = new Set();
    for (const s of list) {
      await resetAndQueueRejudge(s.sid);
      if (s.pid) affectedPids.add(Number(s.pid));
    }
    for (const pid of affectedPids) await refreshProblemJudgeStats(pid);
    return ok(res, { message: 'ok', total: list.length });
  }),
];

exports.cancelSubmission = [
  requireRejudgePermission,
  handler(async (req, res) => {
    const { sid } = req.body;
    const sub = await db.one('SELECT pid,judgeResult FROM submission WHERE sid=?', [sid]);
    if (!sub || !PENDING_JUDGE_RESULTS.has(Number(sub.judgeResult))) {
      return ok(res, { message: 'ok', skipped: true });
    }
    await db.query(
      'UPDATE submission SET judgeResult=13,time=0,memory=0,score=0,compileResult=NULL,caseResult=NULL WHERE sid=?',
      [sid]
    );
    await exports.clearCase(sid);
    notifyProgress(sid);
    if (sub) await refreshProblemJudgeStats(sub.pid);
    return ok(res, { message: 'ok' });
  }),
];

const canManageSubmissionRecord = async (req, sub) => {
  if (!sub || sub.cid) return false;
  if (req.can('submission.manage.any')) return true;
  return (await problemAuth(req, sub.pid)).manage;
};

const parseProfileJson = (value) => {
  try {
    const profile = value ? JSON.parse(value) : null;
    return profile && typeof profile === 'object' ? profile : null;
  } catch (_) {
    return null;
  }
};

const langSourceFileName = (langName, sid) => {
  const lang = getLanguage(langName);
  return (lang && lang.sourceFile) || `submission-${sid}.txt`;
};

const loadSubmissionSourceFiles = async (row) => {
  if (!row || row.lang == null) return [];
  const profile = parseProfileJson(row.problemJudgeProfile);
  const slots = profile && profile.submit && Array.isArray(profile.submit.files)
    ? profile.submit.files.filter((f) => f && (f.kind === 'source' || f.kind === 'file'))
    : [];
  const primarySlot = slots.find((f) => f.kind === 'source') || {};
  const slotByName = new Map(slots.filter((f) => f.name).map((f) => [f.name, f]));
  const files = [{
    name: primarySlot.name || langSourceFileName(row.langName, row.sid),
    label: primarySlot.label || '主文件',
    kind: primarySlot.kind || 'source',
    lang: row.lang,
    primary: true,
    content: row.code || '',
  }];
  const extra = await db.query('SELECT fileKey,lang,content FROM submissionFile WHERE sid=? ORDER BY id', [row.sid]);
  for (const f of extra) {
    const slot = slotByName.get(f.fileKey) || {};
    files.push({
      name: f.fileKey,
      label: slot.label || f.fileKey,
      kind: slot.kind || (f.lang == null ? 'file' : 'source'),
      lang: f.lang,
      primary: false,
      content: f.content || '',
    });
  }
  return files;
};

const safeDownloadName = (name, fallback) => {
  const base = path.basename(String(name || '')).replace(/[\0\r\n]/g, '').trim();
  return base && base !== '.' && base !== '..' ? base : fallback;
};

const zipFilesToBase64 = async (files, zipFilename) => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tmpDir = path.join(os.tmpdir(), `nywoj-submission-${stamp}`);
  const zipPath = path.join(os.tmpdir(), `nywoj-submission-${stamp}.zip`);
  try {
    await fsp.mkdir(tmpDir, { recursive: true });
    for (const file of files) {
      const filename = safeDownloadName(file.filename, 'file.txt');
      await fsp.writeFile(path.join(tmpDir, filename), file.content || '', 'utf8');
    }
    await compressing.zip.compressDir(tmpDir, zipPath);
    const buf = await fsp.readFile(zipPath);
    return {
      filename: zipFilename,
      mime: 'application/zip',
      encoding: 'base64',
      content: buf.toString('base64'),
    };
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await fsp.unlink(zipPath).catch(() => {});
  }
};

exports.setSubmissionPublic = handler(async (req, res) => {
  await ensureSubmissionSchema();
  const sid = parseInt(req.body.sid, 10);
  if (!sid) return fail(res, 'bad sid');
  if (typeof req.body.isPublic !== 'boolean') return fail(res, 'isPublic格式错误');
  const sub = await db.one('SELECT sid,pid,uid,cid,isPublic FROM submission WHERE sid=?', [sid]);
  if (!sub) return fail(res, '提交不存在');
  if (sub.cid) return fail(res, '比赛提交不可修改公开性');
  if (!(await canManageSubmissionRecord(req, sub))) return res.status(403).end('403 Forbidden');

  const isPublic = req.body.isPublic ? 1 : 0;
  if (Number(sub.isPublic) !== isPublic) {
    await db.query('UPDATE submission SET isPublic=? WHERE sid=?', [isPublic, sid]);
    notifyProgress(sid);
  }
  return ok(res);
});

exports.deleteSubmission = handler(async (req, res) => {
  await ensureSubmissionSchema();
  const sid = parseInt(req.body.sid, 10);
  if (!sid) return fail(res, 'bad sid');
  const sub = await db.one('SELECT sid,pid,uid,cid FROM submission WHERE sid=?', [sid]);
  if (!sub) return fail(res, '提交不存在');
  if (sub.cid) return fail(res, '比赛提交不可删除');
  if (!(await canManageSubmissionRecord(req, sub))) return res.status(403).end('403 Forbidden');

  await db.tx(async (t) => {
    await t.query('DELETE FROM submissionDetail WHERE sid=?', [sid]);
    await t.query('DELETE FROM submissionFile WHERE sid=?', [sid]);
    await t.query('DELETE FROM submission WHERE sid=?', [sid]);
  });
  await fsp.rm(answerSubmitDirOf(sid), { recursive: true, force: true }).catch(() => {});
  await fsp.unlink(judgeLogPathOf(sid)).catch(() => {});
  await exports.updateProblemSubmitInfo(sub.pid);
  await updateProblemStat(sub.pid);
  notifyProgress(sid);
  return ok(res);
});

exports.downloadSubmissionFile = handler(async (req, res) => {
  await ensureSubmissionSchema();
  const sid = parseInt(req.body.sid, 10);
  if (!sid) return fail(res, 'bad sid');
  const visible = await loadSubmissionInfo(req, sid);
  if (visible.status === 403) return res.status(403).end('403 Forbidden');
  if (visible.status) return fail(res, visible.message || 'error', visible.status);

  const sub = await db.one(
    'SELECT s.sid,s.pid,s.code,s.lang,l.name AS langName FROM submission s LEFT JOIN languages l ON l.id=s.lang WHERE s.sid=?',
    [sid]
  );
  if (!sub) return fail(res, '提交不存在');

  if (sub.lang == null) {
    const dir = answerSubmitDirOf(sid);
    if (!fs.existsSync(dir)) return fail(res, '答案文件不存在');
    const zipPath = path.join(os.tmpdir(), `nywoj-answer-${sid}-${Date.now()}.zip`);
    try {
      await compressing.zip.compressDir(dir, zipPath);
      const buf = await fsp.readFile(zipPath);
      return ok(res, {
        filename: safeDownloadName(req.body.filename, `submission-${sid}-answers.zip`),
        mime: 'application/zip',
        encoding: 'base64',
        content: buf.toString('base64'),
      });
    } finally {
      await fsp.unlink(zipPath).catch(() => {});
    }
  }

  const lang = getLanguage(sub.langName);
  const mainName = (lang && lang.sourceFile) || `submission-${sid}.txt`;
  const files = [{ filename: mainName, content: sub.code || '' }];
  const extra = await db.query('SELECT fileKey,content FROM submissionFile WHERE sid=? ORDER BY id', [sid]);
  for (const f of extra) {
    files.push({ filename: f.fileKey, content: f.content || '' });
  }
  if (files.length > 1) {
    return ok(res, await zipFilesToBase64(files, `submission-${sid}-source.zip`));
  }
  const buf = Buffer.from(files[0].content, 'utf8');
  return ok(res, {
    filename: safeDownloadName(req.body.filename || files[0].filename, `submission-${sid}.txt`),
    mime: 'text/plain; charset=utf-8',
    encoding: 'base64',
    content: buf.toString('base64'),
  });
});

exports.getLangs = handler(async (req, res) => {
  await syncLanguages(db);
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
const answerCaseNameOf = (c) => {
  const raw = c && c.input ? path.basename(String(c.input)) : String(c && c.index || '');
  const name = stripOut(raw.endsWith('.in') ? raw.slice(0, -3) : raw);
  return name && !/[\/\\]/.test(name) && name !== '.' && name !== '..' && !name.includes('\0')
    ? name
    : String(c && c.index || '');
};

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
  await ensureSubmissionSchema();
  let sid = 0;
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

    const pinfo = await db.one('SELECT type,isPublic FROM problem WHERE pid=?', [pid]);
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
      caseNames.add(answerCaseNameOf(c));
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
      'INSERT INTO submission(pid,uid,code,codelength,submitTime,lang,isPublic) VALUES (?,?,?,?,?,?,?)',
      [pid, req.session.uid, '', totalSize, new Date(), null, pinfo.isPublic ? 1 : 0]
    );
    if (!r.affectedRows) { await cleanupZip(); return fail(res, 'error'); }
    sid = r.insertId;

    const dir = answerSubmitDirOf(sid);
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
    if (sid) {
      await fsp.rm(answerSubmitDirOf(sid), { recursive: true, force: true }).catch(() => {});
      await db.query('DELETE FROM submission WHERE sid=?', [sid]).catch(() => {});
    }
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
    name = answerCaseNameOf(hit);
  }
  // config.json 的 input 字段是题目所有者可控的，必须把 name 当成不可信输入再校验一遍。
  if (/[\/\\]/.test(name) || name === '..' || name === '.' || name.includes('\0'))
    return fail(res, '参数非法');

  const baseDir = path.resolve(answerSubmitDirOf(sid));
  const filePath = path.resolve(baseDir, `${name}.out`);
  if (filePath !== path.join(baseDir, `${name}.out`)) return fail(res, '参数非法');
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
