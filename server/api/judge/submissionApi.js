const db = require('../../db');
const { handler, fail, ok } = require('../../db/util');
const config = require('../../config.json');
const { LANGUAGE_ROWS, syncLanguages } = require('./languages');
const judge = require('./core');
const submissionSocket = require('./submissionSocket');
const judgeSocketBridge = require('./socketBridge');
const { problemAuth, updateProblemStat } = require('../problem/core');
const { ensureContestRatingStorageSchema, latestRatingJoin, effectiveRatingExpr } = require('../contest/ratingStorage');

const STATUS_BY_RESULT = {
  0: 'Pending',
  1: 'Pending',
  2: 'Pending',
  3: 'CompilationError',
  4: 'Accepted',
  5: 'WrongAnswer',
  6: 'TimeLimitExceeded',
  7: 'MemoryLimitExceeded',
  8: 'RuntimeError',
  9: 'RuntimeError',
  10: 'OutputLimitExceeded',
  11: 'RuntimeError',
  12: 'SystemError',
  13: 'Canceled',
  14: 'Skipped',
  15: 'PartiallyCorrect',
  16: 'JudgementFailed',
};

const RESULT_CODES_BY_STATUS = {
  Pending: [0, 1, 2],
  CompilationError: [3],
  Accepted: [4],
  WrongAnswer: [5],
  TimeLimitExceeded: [6],
  MemoryLimitExceeded: [7],
  RuntimeError: [8, 9, 11],
  OutputLimitExceeded: [10],
  SystemError: [12],
  Canceled: [13],
  Skipped: [14],
  PartiallyCorrect: [15],
  JudgementFailed: [16],
};

const SUBMISSION_STATISTICS_TOP_COUNT = 100;
const SUBMISSION_STATISTICS_FIELDS = {
  Fastest: { field: 'time', order: 'ASC' },
  MinMemory: { field: 'memory', order: 'ASC' },
  MinAnswerSize: { field: 'codeLength', order: 'ASC' },
  Earliest: { field: 'submitTime', order: 'ASC' },
};

const languageIdByKey = async (value) => {
  await syncLanguages(db);
  const key = String(value || '').trim().toLowerCase();
  if (!key) return null;
  const row = LANGUAGE_ROWS.find((item) =>
    [item.lang, item.name, item.des].some((candidate) => String(candidate || '').toLowerCase() === key)
  );
  if (row) {
    const dbRow = await db.one('SELECT id FROM languages WHERE lang=? OR name=? LIMIT 1', [row.lang, row.name]);
    return dbRow ? dbRow.id : row.id;
  }
  const numeric = parseInt(key, 10);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
};

const uidOf = (req) => Number(req.session && req.session.uid) || 0;

let userMetaSchemaReady = null;

const ensureUserMetaSchema = () => {
  if (!userMetaSchemaReady) {
    userMetaSchemaReady = (async () => {
      const columns = [
        { name: 'nickname', ddl: "VARCHAR(24) NOT NULL DEFAULT ''" },
        { name: 'bio', ddl: "VARCHAR(160) NOT NULL DEFAULT ''" },
        { name: 'avatarInfo', ddl: "VARCHAR(128) NOT NULL DEFAULT ''" },
        { name: 'publicEmail', ddl: 'TINYINT NOT NULL DEFAULT 0' },
      ];
      for (const column of columns) {
        const row = await db.one(
          'SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
          ['userInfo', column.name]
        );
        if (!row || !row.cnt) await db.query(`ALTER TABLE userInfo ADD COLUMN ${column.name} ${column.ddl}`);
      }
      await ensureContestRatingStorageSchema();
    })();
  }
  return userMetaSchemaReady;
};

const queryLimitNumber = (key, fallback) => {
  const section = config.queryLimit || config.QUERY_LIMIT || {};
  const value = section[key];
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

const positiveCount = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
};

const normalizeSubmissionId = (body) => parseInt(body.submissionId || body.sid || body.id, 10);

const normalizeProblemId = async (body) => {
  const pid = parseInt(body.problemId || body.pid, 10);
  if (pid) return pid;
  return 0;
};

const extractContent = (body) => {
  const content = body.content != null ? body.content : body;
  if (typeof content === 'string') {
    return {
      code: content,
      language: body.codeLanguage || body.language || body.lang,
    };
  }
  const raw = content && typeof content === 'object' ? content : {};
  return {
    code: raw.code || raw.source || raw.sourceCode || body.code || '',
    language: raw.language || raw.codeLanguage || body.codeLanguage || body.language || body.lang,
  };
};

const makeCompatReq = (req, body) => ({
  ...req,
  body,
  query: req.query || {},
  session: req.session || {},
  perms: req.perms,
  can: req.can,
});

const callLocal = (stack, req, body) => new Promise((resolve, reject) => {
  const handlers = Array.isArray(stack) ? stack : [stack];
  const compatReq = makeCompatReq(req, body);
  const result = { status: 200, body: undefined, ended: false };
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    send(payload) {
      result.body = payload;
      result.ended = true;
      resolve(result);
      return this;
    },
    end(payload) {
      result.body = payload;
      result.ended = true;
      resolve(result);
      return this;
    },
  };
  let index = 0;
  const next = (err) => {
    if (err) return reject(err);
    const fn = handlers[index++];
    if (!fn) {
      if (!result.ended) resolve(result);
      return null;
    }
    try {
      return Promise.resolve(fn(compatReq, res, next)).then(() => {
        if (!result.ended && index >= handlers.length) resolve(result);
      }, reject);
    } catch (e) {
      return reject(e);
    }
  };
  next();
});

const localError = (result, fallback = 'PERMISSION_DENIED') => {
  if (result.status === 403) return fallback;
  const message = result.body && result.body.message ? String(result.body.message) : '';
  if (/不存在|not found|no such/i.test(message)) return 'NO_SUCH_SUBMISSION';
  if (/权限|permission|forbidden/i.test(message)) return 'PERMISSION_DENIED';
  return null;
};

const parseAvatar = (row) => {
  const info = String(row.avatarInfo || '').trim();
  const pos = info.indexOf(':');
  if (pos > 0) return { type: info.slice(0, pos), key: info.slice(pos + 1) };
  if (row.qq) return { type: 'qq', key: String(row.qq) };
  return { type: 'qq', key: '' };
};

const acceptedCountExpr = (uidSql = 'u.uid') =>
  `(SELECT COUNT(DISTINCT s2.pid) FROM submission s2 WHERE s2.uid=${uidSql} AND s2.judgeResult=4)`;

const submissionCountExpr = (uidSql = 'u.uid') =>
  `(SELECT COUNT(*) FROM submission s3 WHERE s3.uid=${uidSql})`;

const canViewUserEmail = (req, row) =>
  !!(row && row.publicEmail) ||
  Number(row && row.uid) === Number(uidOf(req)) ||
  !!(req.can && (req.can('user.manage') || req.can('user.role.admin')));

const submitterMetaFromRow = (req, row) => ({
  id: row.uid,
  uid: row.uid,
  username: row.name,
  name: row.name,
  email: canViewUserEmail(req, row) ? row.email || '' : '',
  nickname: row.nickname || '',
  bio: row.bio || '',
  avatar: parseAvatar(row),
  isAdmin: Number(row.uid) === 1,
  acceptedProblemCount: Number(row.acceptedProblemCount || 0),
  submissionCount: Number(row.submissionCount || 0),
  rating: Number(row.rating || 0),
  registrationTime: row.reg_time || null,
});

const problemTypeOf = (type) => ([2, 3].includes(Number(type)) ? 'SubmitAnswer' : 'Traditional');

const isAnswerType = (type) => [2, 3].includes(Number(type));

const metaFromRow = (req, row) => ({
  id: row.sid,
  sid: row.sid,
  isPublic: !!row.isPublic,
  codeLanguage: row.langKey || row.langName || '',
  answerSize: Number(row.codeLength || 0),
  score: row.score == null ? null : Number(row.score),
  status: STATUS_BY_RESULT[Number(row.judgeResult)] || 'Pending',
  submitTime: row.submitTime,
  timeUsed: row.time == null ? null : Number(row.time),
  memoryUsed: row.memory == null ? null : Number(row.memory),
  problem: {
    id: row.pid,
    pid: row.pid,
    type: problemTypeOf(row.problemType),
    isPublic: !!row.problemPublic,
    publicTime: row.problemTime,
    ownerId: row.publisher,
    locales: ['zh-CN'],
    submissionCount: Number(row.submitCnt || 0),
    acceptedSubmissionCount: Number(row.acCnt || 0),
  },
  problemTitle: row.title,
  submitter: submitterMetaFromRow(req, row),
});

const loadSubmissionMetaRow = async (sid) => {
  await ensureUserMetaSchema();
  return db.one(
    `SELECT s.sid,s.uid,s.pid,s.cid,s.judgeResult,s.time,s.memory,s.score,s.code,s.codeLength,s.submitTime,s.lang,s.isPublic,
          l.name AS langName,l.lang AS langKey,
          u.name,u.email,u.publicEmail,u.qq,u.avatarInfo,u.nickname,u.bio,${effectiveRatingExpr('u')} AS rating,u.reg_time,
          ${acceptedCountExpr('u.uid')} AS acceptedProblemCount,
          ${submissionCountExpr('u.uid')} AS submissionCount,
          p.title,p.type AS problemType,p.isPublic AS problemPublic,p.time AS problemTime,
          p.publisher,p.submitCnt,p.acCnt
     FROM submission s
     INNER JOIN userInfo u ON u.uid=s.uid
     ${latestRatingJoin('u')}
     INNER JOIN problem p ON p.pid=s.pid
     LEFT JOIN languages l ON l.id=s.lang
    WHERE s.sid=?`,
    [sid]
  );
};

const canModifyProblemForSubmission = async (req, submission) => {
  if (!submission || !uidOf(req)) return false;
  return !!(await problemAuth(req, submission.pid)).manage;
};

const canViewSubmission = async (req, submission) => {
  if (!submission) return false;
  if (submission.isPublic) return true;
  if (!uidOf(req)) return false;
  if (Number(submission.uid) === uidOf(req)) return true;
  return canModifyProblemForSubmission(req, submission);
};

const canRejudgeSubmission = async (req, submission) =>
  canModifyProblemForSubmission(req, submission);

const canCancelSubmission = async (req, submission) => {
  if (!submission || !uidOf(req)) return false;
  if (Number(submission.uid) === uidOf(req)) return true;
  return canModifyProblemForSubmission(req, submission);
};

const canManageSubmissionRecord = async (req, submission) => {
  if (!submission || !uidOf(req) || submission.cid) return false;
  if (req.can && req.can('submission.manage.any')) return true;
  return !!(await problemAuth(req, submission.pid)).manage;
};

const buildSubmissionConditions = (pid, submitterUid, langId, resultCodes, publicOnly) => {
  const params = [];
  const where = [];
  if (pid) { where.push('s.pid=?'); params.push(pid); }
  if (submitterUid) { where.push('s.uid=?'); params.push(submitterUid); }
  if (langId) { where.push('s.lang=?'); params.push(langId); }
  if (resultCodes && resultCodes.length) {
    where.push(`s.judgeResult IN (${resultCodes.map(() => '?').join(',')})`);
    params.push(...resultCodes);
  }

  if (publicOnly) where.push('s.isPublic=1');
  return { where, params };
};

const clauseOf = (where) => where.length ? `WHERE ${where.join(' AND ')}` : '';

const querySubmissionRows = async (req, pid, submitterUid, langId, resultCodes, publicOnly, takeCount) => {
  await ensureUserMetaSchema();
  const base = buildSubmissionConditions(pid, submitterUid, langId, resultCodes, publicOnly);
  const where = [...base.where];
  const params = [...base.params];
  const minId = Number(req.body.minId);
  const maxId = Number(req.body.maxId);
  const reversed = Number.isSafeInteger(minId) && minId > 0;
  if (reversed) {
    where.push('s.sid>=?');
    params.push(minId);
  } else if (Number.isSafeInteger(maxId) && maxId > 0) {
    where.push('s.sid<=?');
    params.push(maxId);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.query(
    `SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.codeLength,s.submitTime,s.lang,s.isPublic,
            l.name AS langName,l.lang AS langKey,
            u.name,u.email,u.publicEmail,u.qq,u.avatarInfo,u.nickname,u.bio,${effectiveRatingExpr('u')} AS rating,u.reg_time,
            ${acceptedCountExpr('u.uid')} AS acceptedProblemCount,
            ${submissionCountExpr('u.uid')} AS submissionCount,
            p.title,p.type AS problemType,p.isPublic AS problemPublic,p.time AS problemTime,
            p.publisher,p.submitCnt,p.acCnt
       FROM submission s
       INNER JOIN userInfo u ON u.uid=s.uid
       ${latestRatingJoin('u')}
       INNER JOIN problem p ON p.pid=s.pid
       LEFT JOIN languages l ON l.id=s.lang
      ${clause}
      ORDER BY s.sid ${reversed ? 'ASC' : 'DESC'}
      LIMIT ?`,
    [...params, Math.min(positiveCount(takeCount, queryLimitNumber('submissions', 10)), queryLimitNumber('submissions', 10))]
  );
  if (reversed) rows.reverse();
  if (!rows.length) return { rows, hasSmallerId: false, hasLargerId: false };
  const largestId = Number(rows[0].sid);
  const smallestId = Number(rows[rows.length - 1].sid);
  const baseClause = clauseOf(base.where);
  const [hasSmaller, hasLarger] = await Promise.all([
    db.exists(`${baseClause ? `SELECT 1 FROM submission s INNER JOIN problem p ON p.pid=s.pid ${baseClause} AND` : 'SELECT 1 FROM submission s INNER JOIN problem p ON p.pid=s.pid WHERE'} s.sid<? LIMIT 1`, [...base.params, smallestId]),
    db.exists(`${baseClause ? `SELECT 1 FROM submission s INNER JOIN problem p ON p.pid=s.pid ${baseClause} AND` : 'SELECT 1 FROM submission s INNER JOIN problem p ON p.pid=s.pid WHERE'} s.sid>? LIMIT 1`, [...base.params, largestId]),
  ]);
  return { rows, hasSmallerId: !!hasSmaller, hasLargerId: !!hasLarger };
};

const submissionStatisticsIds = async (pid, statisticsType, skipCount, takeCount) => {
  const stat = SUBMISSION_STATISTICS_FIELDS[statisticsType];
  if (!stat) return null;
  const skip = Math.max(Number(skipCount || 0) || 0, 0);
  const take = positiveCount(takeCount, queryLimitNumber('submissionStatistics', 10));
  const sliceCount = Math.max(0, Math.min(take, SUBMISSION_STATISTICS_TOP_COUNT - skip));
  const countRow = await db.one(
    `SELECT COUNT(*) AS total
       FROM (
         SELECT uid
           FROM submission
          WHERE pid=? AND cid=0 AND judgeResult=4 AND ${stat.field} IS NOT NULL
          GROUP BY uid
          LIMIT ${SUBMISSION_STATISTICS_TOP_COUNT}
       ) acceptedUsers`,
    [pid]
  );
  if (sliceCount <= 0) return { ids: [], count: Number(countRow && countRow.total || 0) };
  const rows = await db.query(
    `SELECT MIN(s.sid) AS sid,best.fieldValue
       FROM submission s
       INNER JOIN (
         SELECT uid,MIN(${stat.field}) AS fieldValue
           FROM submission
          WHERE pid=? AND cid=0 AND judgeResult=4 AND ${stat.field} IS NOT NULL
          GROUP BY uid
          ORDER BY fieldValue ${stat.order}
          LIMIT ${SUBMISSION_STATISTICS_TOP_COUNT}
       ) best ON best.uid=s.uid AND s.${stat.field}=best.fieldValue
      WHERE s.pid=? AND s.cid=0 AND s.judgeResult=4
      GROUP BY s.uid,best.fieldValue
      ORDER BY best.fieldValue ${stat.order},sid ASC
      LIMIT ?,?`,
    [pid, pid, skip, sliceCount]
  );
  return {
    ids: rows.map((row) => Number(row.sid)).filter(Boolean),
    count: Number(countRow && countRow.total || 0),
  };
};

const submissionScoreHistogram = async (pid) => {
  const scoreRows = await db.query(
    'SELECT score,COUNT(*) AS cnt FROM submission WHERE pid=? AND score IS NOT NULL GROUP BY score',
    [pid]
  );
  const scores = new Array(101).fill(0);
  for (const row of scoreRows) {
    const score = Number(row.score);
    if (Number.isInteger(score) && score >= 0 && score <= 100) scores[score] = Number(row.cnt) || 0;
  }
  return scores;
};

exports.submit = handler(async (req, res) => {
  const pid = await normalizeProblemId(req.body || {});
  if (!pid) return ok(res, { error: 'NO_SUCH_PROBLEM' });
  const { code, language } = extractContent(req.body || {});
  const lang = await languageIdByKey(language);
  if (!lang) return fail(res, '非法语言');
  const result = await callLocal(judge.submit, req, { pid, code, lang });
  if (result.status === 200 && result.body && result.body.sid) {
    return ok(res, { submissionId: result.body.sid, sid: result.body.sid });
  }
  if (result.status === 403) return ok(res, { error: 'PERMISSION_DENIED' });
  const message = result.body && result.body.message ? String(result.body.message) : '';
  if (/题目不存在|无权限查看|权限不足/.test(message)) return ok(res, { error: 'PERMISSION_DENIED' });
  return fail(res, message || '提交失败', result.status || 202);
});

exports.querySubmission = handler(async (req, res) => {
  const pid = await normalizeProblemId(req.body || {});
  if ((req.body.problemId || req.body.pid) && !pid) {
    return ok(res, { error: 'NO_SUCH_PROBLEM' });
  }
  let filterProblemVisible = false;
  if (req.body.problemId || req.body.pid) {
    const problemExists = await db.exists('SELECT 1 FROM problem WHERE pid=?', [pid]);
    if (!problemExists) return ok(res, { error: 'NO_SUCH_PROBLEM' });
    filterProblemVisible = !!(await problemAuth(req, pid)).view;
  }
  let submitterUid = null;
  if (req.body.submitter) {
    const user = await db.one('SELECT uid FROM userInfo WHERE name=? LIMIT 1', [req.body.submitter]);
    if (!user) return ok(res, { error: 'NO_SUCH_USER' });
    submitterUid = user.uid;
  }
  const langId = req.body.codeLanguage ? await languageIdByKey(req.body.codeLanguage) : null;
  const resultCodes = req.body.status ? RESULT_CODES_BY_STATUS[req.body.status] : null;
  if (req.body.status && !resultCodes) {
    return ok(res, {
      submissions: [],
      progressSubscriptionKey: null,
      hasSmallerId: false,
      hasLargerId: false,
    });
  }
  const hasManageProblemPrivilege = !!(req.can && req.can('problem.manage.any'));
  const isSubmissionsOwned = !!(submitterUid && uidOf(req) && Number(submitterUid) === uidOf(req));
  const publicOnly = !(hasManageProblemPrivilege || filterProblemVisible || isSubmissionsOwned);
  const queryResult = await querySubmissionRows(req, pid, submitterUid, langId, resultCodes, publicOnly, req.body.takeCount);
  const rows = queryResult.rows;
  const pendingIds = rows
    .filter((row) => submissionSocket.isPendingResult(row.judgeResult))
    .map((row) => Number(row.sid));
  return ok(res, {
    submissions: rows.map((row) => metaFromRow(req, row)),
    progressSubscriptionKey: pendingIds.length
      ? submissionSocket.encodeSubscription({ type: 0, submissionIds: pendingIds })
      : null,
    hasSmallerId: queryResult.hasSmallerId,
    hasLargerId: queryResult.hasLargerId,
  });
});

exports.getSubmissionDetail = handler(async (req, res) => {
  const sid = normalizeSubmissionId(req.body || {});
  if (!sid) return ok(res, { error: 'NO_SUCH_SUBMISSION' });
  const metaRow = await loadSubmissionMetaRow(sid);
  if (!metaRow) return ok(res, { error: 'NO_SUCH_SUBMISSION' });
  if (!(await canViewSubmission(req, metaRow))) return ok(res, { error: 'PERMISSION_DENIED' });
  const info = await judge.loadSubmissionInfo(req, sid);
  const data = info.data || {
    sid,
    code: metaRow.code || '',
    canDownload: true,
  };
  const pending = submissionSocket.isPendingResult(metaRow.judgeResult);
  const permissionRejudge = await canRejudgeSubmission(req, metaRow);
  const permissionCancel = await canCancelSubmission(req, metaRow);
  const permissionManagePublicness = await canManageSubmissionRecord(req, metaRow);
  data.canRejudge = permissionRejudge;
  data.canSetPublic = permissionManagePublicness;
  data.canDelete = permissionManagePublicness;
  return ok(res, {
    meta: metaFromRow(req, metaRow),
    content: {
      language: metaRow.langKey || metaRow.langName || '',
      code: data.code || metaRow.code || '',
      compileAndRunOptions: {},
    },
    progress: await submissionSocket.loadProgressDetail(metaRow),
    progressSubscriptionKey: pending
      ? submissionSocket.encodeSubscription({ type: 1, submissionIds: [sid] })
      : null,
    permissionRejudge,
    permissionCancel,
    permissionSetPublic: permissionManagePublicness,
    permissionDelete: permissionManagePublicness,
    data,
  });
});

exports.downloadSubmissionFile = handler(async (req, res) => {
  const sid = normalizeSubmissionId(req.body || {});
  if (!sid) return ok(res, { error: 'NO_SUCH_SUBMISSION' });
  const metaRow = await loadSubmissionMetaRow(sid);
  if (!metaRow) return ok(res, { error: 'NO_SUCH_SUBMISSION' });
  if (!(await canViewSubmission(req, metaRow))) return ok(res, { error: 'PERMISSION_DENIED' });
  const result = await callLocal(judge.downloadSubmissionFile, req, { sid, filename: req.body.filename });
  if (result.status === 403) return ok(res, { error: 'PERMISSION_DENIED' });
  if (result.status !== 200 || !result.body) return ok(res, { error: 'NO_SUCH_FILE' });
  const body = result.body;
  if (!body.content) return ok(res, { error: 'NO_SUCH_FILE' });
  return ok(res, {
    url: `data:${body.mime || 'application/octet-stream'};base64,${body.content}`,
    ...body,
  });
});

exports.querySubmissionStatistics = handler(async (req, res) => {
  const takeCount = positiveCount(req.body.takeCount ?? req.body.pageSize, queryLimitNumber('submissionStatistics', 10));
  if (takeCount > queryLimitNumber('submissionStatistics', 10)) return ok(res, { error: 'TAKE_TOO_MANY' });
  const pid = await normalizeProblemId(req.body || {});
  if (!pid) return ok(res, { error: 'NO_SUCH_PROBLEM' });
  const problem = await db.one('SELECT pid,type FROM problem WHERE pid=?', [pid]);
  if (!problem) return ok(res, { error: 'NO_SUCH_PROBLEM' });
  if (isAnswerType(problem.type) || !(await problemAuth(req, pid)).view) {
    return ok(res, { error: 'PERMISSION_DENIED' });
  }
  const ranked = await submissionStatisticsIds(pid, req.body.statisticsType, req.body.skipCount, takeCount);
  if (!ranked) return ok(res, { error: 'PERMISSION_DENIED' });
  const metas = [];
  for (const sid of ranked.ids) {
    const metaRow = await loadSubmissionMetaRow(sid);
    if (metaRow) metas.push(metaFromRow(req, metaRow));
  }
  return ok(res, {
    submissions: metas,
    count: ranked.count,
    scores: await submissionScoreHistogram(pid),
  });
});

exports.rejudgeSubmission = handler(async (req, res) => {
  const sid = normalizeSubmissionId(req.body || {});
  if (!sid) return ok(res, { error: 'NO_SUCH_SUBMISSION' });
  const sub = await loadSubmissionMetaRow(sid);
  if (!sub) return ok(res, { error: 'NO_SUCH_SUBMISSION' });
  if (!(await canRejudgeSubmission(req, sub))) return ok(res, { error: 'PERMISSION_DENIED' });
  const result = await callLocal(judge.reJudge, req, { sid });
  const err = localError(result);
  if (err) return ok(res, { error: err });
  return ok(res);
});

exports.cancelSubmission = handler(async (req, res) => {
  const sid = normalizeSubmissionId(req.body || {});
  if (!sid) return ok(res, { error: 'NO_SUCH_SUBMISSION' });
  const sub = await db.one('SELECT sid,pid,uid,judgeResult FROM submission WHERE sid=?', [sid]);
  if (!sub) return ok(res, { error: 'NO_SUCH_SUBMISSION' });
  if (!(await canCancelSubmission(req, sub))) return ok(res, { error: 'PERMISSION_DENIED' });
  if (!submissionSocket.isPendingResult(sub.judgeResult)) return ok(res);

  await db.query(
    'UPDATE submission SET judgeResult=13,time=0,memory=0,score=0,compileResult=NULL,caseResult=NULL WHERE sid=?',
    [sid]
  );
  await judge.clearCase(sid);
  judgeSocketBridge.cancelSid(sid);
  judge.notifySubmissionProgress(sid);
  await judge.updateProblemSubmitInfo(sub.pid);
  await updateProblemStat(sub.pid);
  return ok(res);
});

exports.setSubmissionPublic = handler(async (req, res) => {
  const sid = normalizeSubmissionId(req.body || {});
  if (!sid) return ok(res, { error: 'NO_SUCH_SUBMISSION' });
  const sub = await loadSubmissionMetaRow(sid);
  if (!sub) return ok(res, { error: 'NO_SUCH_SUBMISSION' });
  if (!(await canManageSubmissionRecord(req, sub))) return ok(res, { error: 'PERMISSION_DENIED' });
  const result = await callLocal(judge.setSubmissionPublic, req, { sid, isPublic: !!req.body.isPublic });
  const err = localError(result);
  if (err) return ok(res, { error: err });
  return ok(res);
});

exports.deleteSubmission = handler(async (req, res) => {
  const sid = normalizeSubmissionId(req.body || {});
  if (!sid) return ok(res, { error: 'NO_SUCH_SUBMISSION' });
  const sub = await loadSubmissionMetaRow(sid);
  if (!sub) return ok(res, { error: 'NO_SUCH_SUBMISSION' });
  if (!(await canManageSubmissionRecord(req, sub))) return ok(res, { error: 'PERMISSION_DENIED' });
  const result = await callLocal(judge.deleteSubmission, req, { sid });
  const err = localError(result);
  if (err) return ok(res, { error: err });
  return ok(res);
});
