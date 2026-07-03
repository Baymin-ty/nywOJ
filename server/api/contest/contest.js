const db = require('../../db');
const { handler, fail, ok, paginate } = require('../../db/util');
const { requirePermission } = require('../../auth/middleware');
const { Format, briefFormat, kbFormat } = require('../../static');
const { judgeRes, formatSubmissionRow, formatCaseRow, ctype, cstatus } = require('../../db/format');
const { pushSidIntoQueue, streamSubmission } = require('../judge/core');
const { getProblemLang, problemAuth, loadProblemSamples } = require('../problem/core');
const { readJudgeLogEntries } = require('../judge/log');
const {
  ensureContestRatingStorageSchema,
  ensureContestRatingPrimaryKey,
  ensureContestRatingAuxiliaryIndexes,
  contestRatingUniqueConstraintStatus,
  contestRatingAuxiliaryIndexStatus,
  latestActiveRatingRowsSql,
} = require('./ratingStorage');

const ctypeToIndex = { OI: 0, IOI: 1 };
const ptype = ['传统文本比较', 'Special Judge'];
const RATING_DEFAULT = 1500;
const RATING_K = 80;
const RATING_MAX_DELTA = 400;
const RATING_MIN_PARTICIPANTS = 2;
const RATING_PENDING_RESULTS = [0, 1, 2];
const RATING_ALGORITHM = 'elo-rank-v1';
const RATING_DRIFT_REPORT_LIMIT = 10;
const RATING_LOCK_NAME = 'nywoj:contest-rating';
const RATING_LOCK_TIMEOUT_SECONDS = 10;
const RATING_LOCK_BUSY_MESSAGE = 'Rating 正在结算或重建，请稍后重试';
const RATING_CACHE_TMP_TABLE = 'tmpContestRatingCache';
const RATING_DEDUP_TMP_TABLE = 'tmpContestRatingDedup';
const RATING_POLICY = {
  algorithm: RATING_ALGORITHM,
  defaultRating: RATING_DEFAULT,
  kFactor: RATING_K,
  maxDelta: RATING_MAX_DELTA,
  minParticipants: RATING_MIN_PARTICIPANTS,
};

// ---- shared helpers ----
const ensureContestRatingSchema = ensureContestRatingStorageSchema;

// Mirrors problem.js#problemAuth.manage (by cid):
//   manage = (host AND contest.manage.self) OR contest.manage.any (scoped or global)
// contest.manage.any covers everything contest.edit.any + contest.player.manage
// did before — the two were collapsed in 2026-05.
const canManageContest = async (req, cid) => {
  if (!cid) return null;
  const contest = await getContest(cid);
  if (!contest) return null;
  const isHost = contest.host === req.session.uid;
  if (isHost && req.can('contest.manage.self')) return true;
  return req.can('contest.manage.any', { type: 'contest', id: Number(contest.cid) });
};
exports.canManageContest = canManageContest;

const canManageRatingSystem = (req) => !!(req.can && req.can('user.role.admin'));

const contestStatus = (info) => {
  if (info.done) return 3;
  if (Date.now() > info.start.getTime() + info.length * 1000 * 60) return 2;
  return Date.now() >= info.start.getTime() ? 1 : 0;
};

const isReg = (uid, cid) =>
  db.exists('SELECT 1 FROM contestPlayer WHERE uid=? AND cid=? LIMIT 1', [uid, cid]);

// Shared flow summary (judgeProfile.js): preset/submitMode/pipeGroupCount/
// interactive plus compile/steps structure for the submission-page pipeline view.
const { summarizeProfileFlow: summarizeJudgeProfile } = require('../problem/judgeProfile');

const scopedContestIds = (req) => {
  const ids = new Set();
  const bucket = req.perms?.scoped?.get('contest.manage.any');
  if (!bucket) return [];
  for (const tag of bucket) {
    const m = /^contest:(\d+)$/.exec(tag);
    if (m) ids.add(Number(m[1]));
  }
  return [...ids];
};

const contestListVisibility = (req) => {
  if (req.can('contest.manage.any')) return { where: '', params: [] };
  const parts = ['c.isPublic=1'];
  const params = [];
  if (req.session.uid) {
    parts.push('c.host=?');
    params.push(req.session.uid);
    parts.push('EXISTS (SELECT 1 FROM contestPlayer cpv WHERE cpv.cid=c.cid AND cpv.uid=?)');
    params.push(req.session.uid);
  }
  const scopedCids = scopedContestIds(req);
  if (scopedCids.length) {
    parts.push(`c.cid IN (${scopedCids.map(() => '?').join(',')})`);
    params.push(...scopedCids);
  }
  return { where: `WHERE (${parts.join(' OR ')})`, params };
};

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
const activeRatingRowsFrom =
  'FROM contestRating cr INNER JOIN contest c ON c.cid=cr.cid INNER JOIN userInfo u ON u.uid=cr.uid WHERE c.done=1 AND c.ratingEnabled=1';
const staleRatingRowsFrom =
  'FROM contestRating cr LEFT JOIN contest c ON c.cid=cr.cid LEFT JOIN userInfo u ON u.uid=cr.uid WHERE c.cid IS NULL OR u.uid IS NULL OR c.done<>1 OR c.ratingEnabled<>1';
const validContestLastSubmissionFrom = (cls = 'cls', player = 'cp', user = 'u', submission = 's') => `
      FROM contestLastSubmission ${cls}
      INNER JOIN contestPlayer ${player} ON ${player}.cid=${cls}.cid AND ${player}.uid=${cls}.uid
      INNER JOIN userInfo ${user} ON ${user}.uid=${cls}.uid
      INNER JOIN submission ${submission} ON ${submission}.sid=${cls}.sid AND ${submission}.cid=${cls}.cid AND ${submission}.uid=${cls}.uid AND ${submission}.pid=${cls}.pid`;
const invalidContestLastSubmissionReasonExpr = (player = 'cp', user = 'u', submission = 's') => `
      CASE
        WHEN ${user}.uid IS NULL THEN 'missingUser'
        WHEN ${player}.uid IS NULL THEN 'notContestPlayer'
        WHEN ${submission}.sid IS NULL THEN 'missingSubmission'
        ELSE 'unknown'
      END`;
const invalidContestLastSubmissionFrom = (cls = 'cls', player = 'cp', user = 'u', submission = 's') => `
      FROM contestLastSubmission ${cls}
      INNER JOIN contest c ON c.cid=${cls}.cid
      LEFT JOIN contestPlayer ${player} ON ${player}.cid=${cls}.cid AND ${player}.uid=${cls}.uid
      LEFT JOIN userInfo ${user} ON ${user}.uid=${cls}.uid
      LEFT JOIN submission ${submission} ON ${submission}.sid=${cls}.sid AND ${submission}.cid=${cls}.cid AND ${submission}.uid=${cls}.uid AND ${submission}.pid=${cls}.pid
     WHERE c.done=1 AND c.ratingEnabled=1
       AND (${player}.uid IS NULL OR ${user}.uid IS NULL OR ${submission}.sid IS NULL)`;
const submittedUserCountByContestSql = (cls = 'cls', player = 'cp', user = 'u', submission = 's') => `
    SELECT ${cls}.cid,COUNT(DISTINCT ${cls}.uid) AS submittedUserCount
      ${validContestLastSubmissionFrom(cls, player, user, submission)}
     GROUP BY ${cls}.cid`;
const pendingRatedContestFrom = `
  FROM contest c
  INNER JOIN (
${submittedUserCountByContestSql('cls', 'cp', 'su', 's')}
    HAVING COUNT(DISTINCT cls.uid)>=${RATING_MIN_PARTICIPANTS}
  ) submitted ON submitted.cid=c.cid
 WHERE c.done=1 AND c.ratingEnabled=1
   AND NOT EXISTS (
     SELECT 1 FROM contestRating cr INNER JOIN userInfo ru ON ru.uid=cr.uid WHERE cr.cid=c.cid
   )`;
const sampleInsufficientRatedContestFrom = `
  FROM contest c
  LEFT JOIN (
${submittedUserCountByContestSql('cls', 'cp', 'su', 's')}
  ) submitted ON submitted.cid=c.cid
 WHERE c.done=1 AND c.ratingEnabled=1
   AND COALESCE(submitted.submittedUserCount,0)<${RATING_MIN_PARTICIPANTS}
   AND NOT EXISTS (
     SELECT 1 FROM contestRating cr INNER JOIN userInfo ru ON ru.uid=cr.uid WHERE cr.cid=c.cid
   )`;
const duplicateRatingGroupsSql = `
  SELECT cid,uid,COUNT(*) AS rowCount
    FROM contestRating
   GROUP BY cid,uid
  HAVING COUNT(*)>1`;

const duplicateRatingSummary = async (runner = db) => {
  const row = await runner.one(
    `SELECT COUNT(*) AS pairCnt,
            COALESCE(SUM(rowCount-1),0) AS rowCnt,
            COUNT(DISTINCT cid) AS contestCnt
       FROM (${duplicateRatingGroupsSql}) duplicated`
  );
  return {
    duplicateRatingPairCount: Number(row && row.pairCnt || 0),
    duplicateRatingRowCount: Number(row && row.rowCnt || 0),
    duplicateRatingContestCount: Number(row && row.contestCnt || 0),
  };
};

const duplicateRatingRowsSample = (limit) =>
  db.query(
    `SELECT duplicated.cid,c.title,c.start,duplicated.uid,u.name AS username,
            duplicated.rowCount,duplicated.rowCount-1 AS duplicateRowCount,
            MIN(cr.updateTime) AS firstUpdateTime,
            MAX(cr.updateTime) AS lastUpdateTime
       FROM (${duplicateRatingGroupsSql}) duplicated
       INNER JOIN contestRating cr ON cr.cid=duplicated.cid AND cr.uid=duplicated.uid
       LEFT JOIN contest c ON c.cid=duplicated.cid
       LEFT JOIN userInfo u ON u.uid=duplicated.uid
      GROUP BY duplicated.cid,c.title,c.start,duplicated.uid,u.name,duplicated.rowCount
      ORDER BY duplicateRowCount DESC,lastUpdateTime DESC,duplicated.cid DESC,duplicated.uid ASC
      LIMIT ?`,
    [limit]
  );
const ratingRowPickOrder =
  'cr.updateTime DESC,cr.rank ASC,cr.totalScore DESC,cr.usedTime ASC,cr.newRating DESC,cr.delta DESC,cr.oldRating DESC,cr.algorithm DESC';

const pickedRatingValue = (column, type = 'SIGNED') =>
  `CAST(SUBSTRING_INDEX(GROUP_CONCAT(${column} ORDER BY ${ratingRowPickOrder} SEPARATOR ','), ',', 1) AS ${type})`;

const pickedRatingText = (column) =>
  `SUBSTRING_INDEX(GROUP_CONCAT(${column} ORDER BY ${ratingRowPickOrder} SEPARATOR ','), ',', 1)`;

const connectionQuery = (conn, sql, params) =>
  new Promise((resolve, reject) => {
    conn.query(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

const connectionOne = async (conn, sql, params) => {
  const rows = await connectionQuery(conn, sql, params);
  return rows && rows.length ? rows[0] : null;
};

const connectionRunner = (conn) => ({
  query: (sql, params) => connectionQuery(conn, sql, params),
  one: (sql, params) => connectionOne(conn, sql, params),
});

const getDbConnection = () =>
  new Promise((resolve, reject) => {
    db.pool.getConnection((err, conn) => {
      if (err) reject(err);
      else resolve(conn);
    });
  });

const beginConnectionTransaction = (conn) =>
  new Promise((resolve, reject) => {
    conn.beginTransaction((err) => (err ? reject(err) : resolve()));
  });

const commitConnectionTransaction = (conn) =>
  new Promise((resolve, reject) => {
    conn.commit((err) => (err ? reject(err) : resolve()));
  });

const rollbackConnectionTransaction = (conn) =>
  new Promise((resolve) => {
    conn.rollback(() => resolve());
  });

const releaseContestRatingLock = async (runner) => {
  try {
    const result = await runner.one('SELECT RELEASE_LOCK(?) AS released', [RATING_LOCK_NAME]);
    return result && Number(result.released) === 1;
  } catch (err) {
    console.error('contest rating lock release failed:', err && err.stack ? err.stack : err);
    return false;
  }
};

const withContestRatingWriteLock = async (work) => {
  const conn = await getDbConnection();
  const tx = connectionRunner(conn);
  let lockHeld = false;
  try {
    await beginConnectionTransaction(conn);
    const lock = await tx.one(
      'SELECT GET_LOCK(?, ?) AS locked',
      [RATING_LOCK_NAME, RATING_LOCK_TIMEOUT_SECONDS]
    );
    if (!lock || Number(lock.locked) !== 1) {
      await rollbackConnectionTransaction(conn);
      return { locked: true, changes: [] };
    }
    lockHeld = true;

    const result = await work(tx);
    await commitConnectionTransaction(conn);
    return result;
  } catch (err) {
    await rollbackConnectionTransaction(conn);
    throw err;
  } finally {
    const lockReleased = lockHeld ? await releaseContestRatingLock(tx) : true;
    if (lockReleased) conn.release();
    else conn.destroy();
  }
};

const failIfRatingLocked = (res, result) => {
  if (!result || !result.locked) return false;
  fail(res, RATING_LOCK_BUSY_MESSAGE);
  return true;
};

const ratingAdminSampleLimit = (req, fallback = 10) => {
  const body = req && req.body || {};
  return Math.max(10, Math.min(parseInt(body.limit || body.takeCount || fallback, 10) || fallback, 100));
};

const ratingPreviewDetailLimit = (req, fallback = 100) => {
  const body = req && req.body || {};
  return Math.max(10, Math.min(parseInt(body.detailLimit || body.limit || body.takeCount || fallback, 10) || fallback, 500));
};

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

const buildContestRatingStatus = (
  contest,
  status,
  rowCount,
  submittedUserCount,
  pendingJudgementCount = 0,
  invalidLastSubmissionCount = 0,
  pendingJudgementUserCount = 0,
  pendingJudgementProblemCount = 0
) => {
  const base = {
    submittedUserCount,
    pendingJudgementCount,
    invalidLastSubmissionCount,
    pendingJudgementUserCount,
    pendingJudgementProblemCount,
  };
  if (!contest || !contest.ratingEnabled) {
    return { ...base, state: 'unrated', label: 'Unrated', type: 'info', settled: false };
  }
  if (status !== 3) {
    return { ...base, state: 'rated', label: 'Rated', type: 'warning', settled: false };
  }
  if (submittedUserCount < RATING_MIN_PARTICIPANTS) {
    return {
      ...base,
      state: 'skipped',
      label: '样本不足',
      type: 'info',
      settled: false,
      rowCount,
      minParticipantCount: RATING_MIN_PARTICIPANTS,
    };
  }
  if (pendingJudgementCount > 0) {
    return { ...base, state: 'judging', label: '等待测评', type: 'warning', settled: false, rowCount };
  }
  if (rowCount > 0) {
    return { ...base, state: 'settled', label: '已结算', type: 'success', settled: true, rowCount };
  }
  if (submittedUserCount >= RATING_MIN_PARTICIPANTS) {
    return { ...base, state: 'pending', label: '待结算', type: 'danger', settled: false, rowCount };
  }
  return { ...base, state: 'skipped', label: '样本不足', type: 'info', settled: false, rowCount, minParticipantCount: RATING_MIN_PARTICIPANTS };
};

const ratingSubmittedUserCount = async (cid) => {
  const row = await db.one(
    `SELECT COUNT(DISTINCT cls.uid) AS cnt
       ${validContestLastSubmissionFrom()}
      WHERE cls.cid=?`,
    [cid]
  );
  return Number(row && row.cnt || 0);
};

const invalidContestLastSubmissionCount = async (cid) => {
  const row = await db.one(
    `SELECT COUNT(*) AS cnt
       ${invalidContestLastSubmissionFrom()}
      AND cls.cid=?`,
    [cid]
  );
  return Number(row && row.cnt || 0);
};

const contestRatingSummary = async (cid) => {
  await ensureContestRatingSchema();
  const [ratingRows, submittedUsers, pendingJudgements, invalidLastSubmissions] = await Promise.all([
    db.one(
      `SELECT COUNT(*) AS cnt
         FROM (
           SELECT cr.uid
             FROM contestRating cr INNER JOIN userInfo u ON u.uid=cr.uid
            WHERE cr.cid=?
            GROUP BY cr.uid
         ) ratingUsers`,
      [cid]
    ),
    ratingSubmittedUserCount(cid),
    db.one(
      `SELECT COUNT(*) AS cnt,
              COUNT(DISTINCT cls.uid) AS userCnt,
              COUNT(DISTINCT s.pid) AS problemCnt
         ${validContestLastSubmissionFrom()}
        WHERE cls.cid=? AND s.judgeResult IN (?)`,
      [cid, RATING_PENDING_RESULTS]
    ),
    invalidContestLastSubmissionCount(cid),
  ]);
  return {
    rowCount: Number(ratingRows && ratingRows.cnt || 0),
    submittedUserCount: Number(submittedUsers || 0),
    pendingJudgementCount: Number(pendingJudgements && pendingJudgements.cnt || 0),
    pendingJudgementUserCount: Number(pendingJudgements && pendingJudgements.userCnt || 0),
    pendingJudgementProblemCount: Number(pendingJudgements && pendingJudgements.problemCnt || 0),
    invalidLastSubmissionCount: Number(invalidLastSubmissions || 0),
  };
};

const attachContestRatingStatus = async (contest, status = null) => {
  contest.ratingStatus = await contestRatingStatusForContest(contest, status);
  return contest;
};

const contestRatingStatusForContest = async (contest, status = null) => {
  const summary = await contestRatingSummary(contest.cid);
  return buildContestRatingStatus(
    contest,
    status == null ? contestStatus(contest) : status,
    summary.rowCount,
    summary.submittedUserCount,
    summary.pendingJudgementCount,
    summary.invalidLastSubmissionCount,
    summary.pendingJudgementUserCount,
    summary.pendingJudgementProblemCount
  );
};

const ratingStatusResponseMeta = (ratingStatus) => {
  const state = ratingStatus && ratingStatus.state;
  return {
    ratingStatus,
    settled: !!(ratingStatus && ratingStatus.settled),
    unrated: state === 'unrated',
    unsettled: ['rated', 'pending', 'judging'].includes(state),
    sampleInsufficient: state === 'skipped',
    pendingJudgement: state === 'judging',
    submittedUserCount: Number(ratingStatus && ratingStatus.submittedUserCount || 0),
    pendingJudgementCount: Number(ratingStatus && ratingStatus.pendingJudgementCount || 0),
    pendingJudgementUserCount: Number(ratingStatus && ratingStatus.pendingJudgementUserCount || 0),
    pendingJudgementProblemCount: Number(ratingStatus && ratingStatus.pendingJudgementProblemCount || 0),
    invalidLastSubmissionCount: Number(ratingStatus && ratingStatus.invalidLastSubmissionCount || 0),
    ratingRowCount: Number(ratingStatus && ratingStatus.rowCount || 0),
    minParticipantCount: Number(ratingStatus && ratingStatus.minParticipantCount || RATING_MIN_PARTICIPANTS),
  };
};

const ratingPendingJudgementSummary = async (cid) => {
  const row = await db.one(
    `SELECT COUNT(*) AS count,
            COUNT(DISTINCT cls.uid) AS userCount,
            COUNT(DISTINCT s.pid) AS problemCount,
            MIN(s.sid) AS firstSid
       ${validContestLastSubmissionFrom()}
      WHERE cls.cid=? AND s.judgeResult IN (?)`,
    [cid, RATING_PENDING_RESULTS]
  );
  return {
    count: Number(row && row.count || 0),
    userCount: Number(row && row.userCount || 0),
    problemCount: Number(row && row.problemCount || 0),
    firstSid: row && row.firstSid ? Number(row.firstSid) : null,
  };
};

const buildContestRank = async (cid) => {
  const submissions = await db.query(
    `SELECT s.uid,s.pid,s.time,s.score
       FROM contestLastSubmission cls
       INNER JOIN submission s ON s.sid=cls.sid AND s.cid=cls.cid AND s.uid=cls.uid AND s.pid=cls.pid
      WHERE cls.cid=?
      ORDER BY s.time ASC,s.sid ASC`,
    [cid]
  );
  const problems = await db.query('SELECT pid,idx,weight FROM contestProblem WHERE cid=?', [cid]);
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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const calculateContestRatingChanges = async (cid, baseRatings = null, options = {}) => {
  const { rank } = await buildContestRank(cid);
  const ratedRank = rank.filter((row) => row.submitted);
  if (ratedRank.length < RATING_MIN_PARTICIPANTS) return [];
  const useCurrentRatingForMissing = options.useCurrentRatingForMissing !== false;
  const changes = ratedRank.map((row) => ({
    uid: row.user.uid,
    username: row.user.name,
    rank: row.rank,
    totalScore: Number(row.totalScore || 0),
    usedTime: Number(row.usedTime || 0),
    oldRating: (() => {
      const uid = Number(row.user.uid);
      if (baseRatings && baseRatings.has(uid)) return Number(baseRatings.get(uid));
      if (!useCurrentRatingForMissing) return RATING_DEFAULT;
      const currentRating = Number(row.user.rating || 0);
      return currentRating > 0 ? currentRating : RATING_DEFAULT;
    })(),
  }));

  for (const cur of changes) {
    let actual = 0;
    let expected = 0;
    for (const other of changes) {
      if (other.uid === cur.uid) continue;
      expected += 1 / (1 + Math.pow(10, (other.oldRating - cur.oldRating) / 400));
      if (cur.rank < other.rank) actual += 1;
      else if (cur.rank === other.rank) actual += 0.5;
    }
    const rawDelta = Math.round((RATING_K * (actual - expected)) / (changes.length - 1));
    cur.delta = clamp(rawDelta, -RATING_MAX_DELTA, RATING_MAX_DELTA);
    cur.newRating = Math.max(1, cur.oldRating + cur.delta);
  }
  return changes;
};

const normalizeRatingComparable = (row) => ({
  uid: Number(row.uid),
  rank: Number(row.rank || 0),
  totalScore: Number(row.totalScore || 0),
  usedTime: Number(row.usedTime || 0),
  oldRating: Number(row.oldRating || 0),
  newRating: Number(row.newRating || 0),
  delta: Number(row.delta || 0),
  algorithm: row.algorithm || RATING_ALGORITHM,
});

const compareContestRatingChanges = (existing, changes) => {
  const fields = ['rank', 'totalScore', 'usedTime', 'oldRating', 'newRating', 'delta', 'algorithm'];
  const existingByUid = new Map(existing.map((row) => [Number(row.uid), row]));
  const changesByUid = new Map(changes.map((row) => [Number(row.uid), row]));
  const uids = [...new Set([...existingByUid.keys(), ...changesByUid.keys()])];
  const mismatches = [];

  for (const uid of uids) {
    const oldRow = existingByUid.get(uid);
    const newRow = changesByUid.get(uid);
    if (!oldRow || !newRow) {
      const row = oldRow || newRow || {};
      mismatches.push({
        uid,
        username: row.username,
        field: oldRow ? 'extraRow' : 'missingRow',
        oldValue: oldRow ? 1 : 0,
        newValue: newRow ? 1 : 0,
      });
      continue;
    }

    const oldComparable = normalizeRatingComparable(oldRow);
    const newComparable = normalizeRatingComparable(newRow);
    for (const field of fields) {
      if (oldComparable[field] !== newComparable[field]) {
        mismatches.push({
          uid,
          username: newRow.username || oldRow.username,
          field,
          oldValue: oldComparable[field],
          newValue: newComparable[field],
        });
        break;
      }
    }
  }

  if (!mismatches.length) {
    return { drifted: false, reason: null, diffUserCount: 0, firstMismatch: null };
  }
  const fieldsChanged = new Set(mismatches.map((row) => row.field));
  let reason = 'changedRows';
  if (fieldsChanged.has('missingRow') && fieldsChanged.has('extraRow')) reason = 'participantChanged';
  else if (fieldsChanged.has('missingRow')) reason = 'missingRows';
  else if (fieldsChanged.has('extraRow')) reason = 'extraRows';
  else if (fieldsChanged.has('algorithm')) reason = 'algorithmChanged';
  else if (fieldsChanged.has('oldRating')) reason = 'ratingTimelineChanged';
  else if (fieldsChanged.has('rank') || fieldsChanged.has('totalScore') || fieldsChanged.has('usedTime')) reason = 'standingChanged';
  return {
    drifted: true,
    reason,
    diffUserCount: mismatches.length,
    firstMismatch: mismatches[0],
  };
};

const ratingRowsForContest = async (cid, options = {}) => {
  await ensureContestRatingSchema();
  const params = [cid];
  let limitSql = '';
  if (options.limit != null) {
    const offset = Math.max(0, Number(options.offset) || 0);
    const limit = Math.max(1, Number(options.limit) || 1);
    limitSql = ' LIMIT ?,?';
    params.push(offset, limit);
  }
  return db.query(
    `SELECT cr.cid,cr.uid,
            ${pickedRatingValue('cr.rank')} AS rank,
            ${pickedRatingValue('cr.totalScore')} AS totalScore,
            ${pickedRatingValue('cr.usedTime')} AS usedTime,
            ${pickedRatingValue('cr.oldRating')} AS oldRating,
            ${pickedRatingValue('cr.newRating')} AS newRating,
            ${pickedRatingValue('cr.delta')} AS delta,
            ${pickedRatingText('cr.algorithm')} AS algorithm,
            MAX(cr.updateTime) AS updateTime,
            u.name AS username
       FROM contestRating cr INNER JOIN userInfo u ON u.uid=cr.uid
      WHERE cr.cid=?
      GROUP BY cr.cid,cr.uid,u.name
      ORDER BY rank ASC,delta DESC,cr.uid ASC${limitSql}`,
    params
  );
};

const baseRatingsBeforeContest = async (contest) => {
  await ensureContestRatingSchema();
  const rows = await db.query(
    `SELECT cr.uid,
            ${pickedRatingValue('cr.newRating')} AS newRating
       FROM contestRating cr
       INNER JOIN contest c ON c.cid=cr.cid
       INNER JOIN userInfo u ON u.uid=cr.uid
      WHERE c.done=1 AND c.ratingEnabled=1
        AND (c.start<? OR (c.start=? AND c.cid<?))
        AND NOT EXISTS (
          SELECT 1
            FROM contestRating cr2 INNER JOIN contest c2 ON c2.cid=cr2.cid
           WHERE cr2.uid=cr.uid AND c2.done=1 AND c2.ratingEnabled=1
             AND (c2.start<? OR (c2.start=? AND c2.cid<?))
             AND (c2.start>c.start OR (c2.start=c.start AND cr2.cid>cr.cid))
        )
      GROUP BY cr.uid`,
    [contest.start, contest.start, contest.cid, contest.start, contest.start, contest.cid]
  );
  return new Map(rows.map((row) => [Number(row.uid), Number(row.newRating)]));
};

const calculateContestRatingChangesFromHistory = async (contest) => {
  const baseRatings = await baseRatingsBeforeContest(contest);
  return calculateContestRatingChanges(contest.cid, baseRatings, {
    useCurrentRatingForMissing: false,
  });
};

const previewContestRatingChanges = async (contest) => {
  await ensureContestRatingSchema();
  if (!contest || !contest.ratingEnabled) {
    return { changes: [], settled: false, unrated: true, blocked: false, conflicts: [], invalidLastSubmissionCount: 0 };
  }
  const existing = await ratingRowsForContest(contest.cid);
  const submittedUserCount = await ratingSubmittedUserCount(contest.cid);
  const invalidLastSubmissionCount = await invalidContestLastSubmissionCount(contest.cid);
  if (submittedUserCount < RATING_MIN_PARTICIPANTS) {
    const comparison = existing.length
      ? compareContestRatingChanges(existing, [])
      : { drifted: false, reason: null, diffUserCount: 0, firstMismatch: null };
    const conflicts = await laterRatingRowsForUsers(
      contest.cid,
      contest.start,
      existing.map((row) => Number(row.uid))
    );
    return {
      changes: [],
      settled: existing.length > 0,
      unrated: false,
      blocked: conflicts.length > 0,
      conflicts,
      pendingJudgement: false,
      pendingJudgementCount: 0,
      sampleInsufficient: true,
      submittedUserCount,
      minParticipantCount: RATING_MIN_PARTICIPANTS,
      invalidLastSubmissionCount,
      drifted: comparison.drifted,
      driftReason: comparison.reason,
      driftDiffUserCount: comparison.diffUserCount,
      driftFirstMismatch: comparison.firstMismatch,
    };
  }
  const pendingJudgement = await ratingPendingJudgementSummary(contest.cid);
  if (pendingJudgement.count) {
    return {
      changes: existing,
      settled: existing.length > 0,
      unrated: false,
      blocked: false,
      conflicts: [],
      pendingJudgement: true,
      pendingJudgementCount: pendingJudgement.count,
      pendingJudgementUserCount: pendingJudgement.userCount,
      pendingJudgementProblemCount: pendingJudgement.problemCount,
      invalidLastSubmissionCount,
    };
  }
  const changes = await calculateContestRatingChangesFromHistory(contest);
  const comparison = existing.length
    ? compareContestRatingChanges(existing, changes)
    : { drifted: false, reason: null, diffUserCount: 0, firstMismatch: null };
  const affectedUids = [...new Set([
    ...changes.map((row) => Number(row.uid)),
    ...existing.map((row) => Number(row.uid)),
  ])];
  const conflicts = await laterRatingRowsForUsers(contest.cid, contest.start, affectedUids);
  return {
    changes,
    settled: existing.length > 0,
    unrated: false,
    blocked: conflicts.length > 0,
    conflicts,
    pendingJudgement: false,
    pendingJudgementCount: 0,
    invalidLastSubmissionCount,
    drifted: comparison.drifted,
    driftReason: comparison.reason,
    driftDiffUserCount: comparison.diffUserCount,
    driftFirstMismatch: comparison.firstMismatch,
  };
};

const persistContestRatingChanges = async (tx, cid, changes) => {
  if (!changes.length) return;
  const now = new Date();
  const values = changes.map((row) => [
    cid,
    row.uid,
    row.rank,
    row.totalScore,
    row.usedTime,
    row.oldRating,
    row.newRating,
    row.delta,
    RATING_ALGORITHM,
    now,
  ]);
  await tx.query(
    `INSERT INTO contestRating
      (cid,uid,rank,totalScore,usedTime,oldRating,newRating,delta,algorithm,updateTime)
     VALUES ?`,
    [values]
  );
  for (const row of changes) {
    await tx.query('UPDATE userInfo SET rating=? WHERE uid=?', [row.newRating, row.uid]);
  }
};

const applyContestRatingUnlocked = async (cid, tx) => {
  await ensureContestRatingSchema();
  const contest = await getContest(cid);
  if (!contest || !contest.ratingEnabled) return { applied: false, unrated: true, changes: [] };
  const existing = await ratingRowsForContest(cid);
  if (existing.length) {
    const sync = await syncUserRatingsFromActiveHistory(tx);
    return { applied: false, changes: existing, sync };
  }
  const submittedUserCount = await ratingSubmittedUserCount(cid);
  const invalidLastSubmissionCount = await invalidContestLastSubmissionCount(cid);
  if (submittedUserCount < RATING_MIN_PARTICIPANTS) {
    return {
      applied: false,
      sampleInsufficient: true,
      submittedUserCount,
      minParticipantCount: RATING_MIN_PARTICIPANTS,
      invalidLastSubmissionCount,
      changes: [],
    };
  }
  const pendingJudgement = await ratingPendingJudgementSummary(cid);
  if (pendingJudgement.count) {
    return {
      applied: false,
      pendingJudgement: true,
      pendingJudgementCount: pendingJudgement.count,
      pendingJudgementUserCount: pendingJudgement.userCount,
      pendingJudgementProblemCount: pendingJudgement.problemCount,
      invalidLastSubmissionCount,
      changes: [],
    };
  }
  const changes = await calculateContestRatingChangesFromHistory(contest);
  if (!changes.length) return { applied: false, changes: [] };
  const affectedUids = [...new Set(changes.map((row) => Number(row.uid)))];
  const laterRows = await laterRatingRowsForUsers(contest.cid, contest.start, affectedUids);
  if (laterRows.length) {
    return {
      applied: false,
      blocked: true,
      submittedUserCount,
      invalidLastSubmissionCount,
      changes,
      conflicts: laterRows,
    };
  }
  await persistContestRatingChanges(tx, cid, changes);
  const sync = await syncUserRatingsFromActiveHistory(tx);
  return { applied: true, changes, sync, invalidLastSubmissionCount };
};

const applyContestRating = async (cid) =>
  withContestRatingWriteLock((tx) => applyContestRatingUnlocked(cid, tx));

const laterRatingRowsForUsers = async (cid, contestStart, uids) => {
  if (!uids.length) return [];
  return db.query(
    `SELECT cr.cid,cr.uid,u.name AS username,c.title,c.start
      FROM contestRating cr
      INNER JOIN contest c ON c.cid=cr.cid
      INNER JOIN userInfo u ON u.uid=cr.uid
      WHERE cr.uid IN (?) AND cr.cid<>? AND c.done=1 AND c.ratingEnabled=1
        AND (c.start>? OR (c.start=? AND cr.cid>?))
      ORDER BY c.start ASC,cr.uid ASC
      LIMIT 10`,
    [uids, cid, contestStart, contestStart, cid]
  );
};

const recalculateContestRating = async (contest) => withContestRatingWriteLock(async (tx) => {
  await ensureContestRatingSchema();
  const existing = await ratingRowsForContest(contest.cid);
  const submittedUserCount = await ratingSubmittedUserCount(contest.cid);
  const invalidLastSubmissionCount = await invalidContestLastSubmissionCount(contest.cid);
  if (submittedUserCount < RATING_MIN_PARTICIPANTS) {
    if (!existing.length) {
      return {
        applied: false,
        sampleInsufficient: true,
        submittedUserCount,
        minParticipantCount: RATING_MIN_PARTICIPANTS,
        invalidLastSubmissionCount,
        changes: [],
      };
    }
    const laterRows = await laterRatingRowsForUsers(
      contest.cid,
      contest.start,
      existing.map((row) => Number(row.uid))
    );
    if (laterRows.length) {
      return {
        applied: false,
        blocked: true,
        sampleInsufficient: true,
        submittedUserCount,
        minParticipantCount: RATING_MIN_PARTICIPANTS,
        invalidLastSubmissionCount,
        changes: existing,
        conflicts: laterRows,
      };
    }
    await tx.query('DELETE FROM contestRating WHERE cid=?', [contest.cid]);
    const sync = await syncUserRatingsFromActiveHistory(tx);
    return {
      applied: true,
      rebuilt: true,
      sampleInsufficient: true,
      submittedUserCount,
      minParticipantCount: RATING_MIN_PARTICIPANTS,
      invalidLastSubmissionCount,
      changes: [],
      sync,
    };
  }
  const pendingJudgement = await ratingPendingJudgementSummary(contest.cid);
  if (pendingJudgement.count) {
    return {
      applied: false,
      pendingJudgement: true,
      pendingJudgementCount: pendingJudgement.count,
      pendingJudgementUserCount: pendingJudgement.userCount,
      pendingJudgementProblemCount: pendingJudgement.problemCount,
      invalidLastSubmissionCount,
      changes: existing,
    };
  }
  if (!existing.length) return applyContestRatingUnlocked(contest.cid, tx);

  const changes = await calculateContestRatingChangesFromHistory(contest);
  const affectedUids = [...new Set([
    ...changes.map((row) => Number(row.uid)),
    ...existing.map((row) => Number(row.uid)),
  ])];
  const laterRows = await laterRatingRowsForUsers(contest.cid, contest.start, affectedUids);
  if (laterRows.length) {
    return {
      applied: false,
      blocked: true,
      submittedUserCount,
      invalidLastSubmissionCount,
      changes: existing,
      conflicts: laterRows,
    };
  }

  await tx.query('DELETE FROM contestRating WHERE cid=?', [contest.cid]);
  await persistContestRatingChanges(tx, contest.cid, changes);
  const sync = await syncUserRatingsFromActiveHistory(tx);
  return { applied: true, rebuilt: true, changes, sync, invalidLastSubmissionCount };
});

const rebuildAllContestRatingsUnlocked = async (options = {}) => {
  await ensureContestRatingSchema();
  const dryRun = !!options.dryRun;
  const includeChanges = !!options.includeChanges;
  const outputLimit = options.outputLimit == null ? null : Math.max(1, Number(options.outputLimit) || 0);
  const writer = options.runner || db;
  const contests = await db.query(
    `SELECT cid,title,start
       FROM contest
      WHERE done=1 AND ratingEnabled=1
      ORDER BY start ASC,cid ASC`
  );
  const currentRatings = new Map();
  const contestResults = [];
  let rowCount = 0;
  let blockedByContest = null;

  for (const contest of contests) {
    if (blockedByContest) {
      contestResults.push({
        cid: contest.cid,
        title: contest.title,
        start: Format(contest.start),
        count: 0,
        changes: [],
        skippedReason: 'timelineBlocked',
        blockedByContest,
      });
      continue;
    }
    const submittedUserCount = await ratingSubmittedUserCount(contest.cid);
    const invalidLastSubmissionCount = await invalidContestLastSubmissionCount(contest.cid);
    if (submittedUserCount < RATING_MIN_PARTICIPANTS) {
      contestResults.push({
        cid: contest.cid,
        title: contest.title,
        start: Format(contest.start),
        count: 0,
        changes: [],
        skippedReason: 'sampleInsufficient',
        submittedUserCount,
        minParticipantCount: RATING_MIN_PARTICIPANTS,
        invalidLastSubmissionCount,
      });
      continue;
    }
    const pendingJudgement = await ratingPendingJudgementSummary(contest.cid);
    if (pendingJudgement.count) {
      blockedByContest = {
        cid: contest.cid,
        title: contest.title,
        start: Format(contest.start),
        pendingJudgementCount: pendingJudgement.count,
        pendingJudgementUserCount: pendingJudgement.userCount,
        pendingJudgementProblemCount: pendingJudgement.problemCount,
        invalidLastSubmissionCount,
      };
      contestResults.push({
        cid: contest.cid,
        title: contest.title,
        start: Format(contest.start),
        count: 0,
        changes: [],
        skippedReason: 'pendingJudgement',
        pendingJudgementCount: pendingJudgement.count,
        pendingJudgementUserCount: pendingJudgement.userCount,
        pendingJudgementProblemCount: pendingJudgement.problemCount,
        submittedUserCount,
        invalidLastSubmissionCount,
      });
      continue;
    }
    const changes = await calculateContestRatingChanges(contest.cid, currentRatings, {
      useCurrentRatingForMissing: false,
    });
    for (const row of changes) currentRatings.set(Number(row.uid), Number(row.newRating));
    rowCount += changes.length;
    contestResults.push({
      cid: contest.cid,
      title: contest.title,
      start: Format(contest.start),
      count: changes.length,
      changes,
      submittedUserCount,
      invalidLastSubmissionCount,
    });
  }

  const ratedContestCount = contestResults.filter((item) => item.count > 0).length;
  const returnedContestCount = outputLimit == null ? contestResults.length : Math.min(outputLimit, contestResults.length);
  const omittedContestCount = contestResults.length - returnedContestCount;
  const writeSkipped = !dryRun && !!blockedByContest;
  const willWrite = !dryRun && !writeSkipped;
  if (willWrite) {
    const writeRebuild = async (tx) => {
      await tx.query('DELETE FROM contestRating');
      await tx.query('UPDATE userInfo SET rating=0');
      for (const item of contestResults) {
        await persistContestRatingChanges(tx, item.cid, item.changes);
      }
    };
    if (options.runner) await writeRebuild(writer);
    else await db.tx(writeRebuild);
  }

  return {
    dryRun,
    contestCount: contests.length,
    ratedContestCount,
    skippedContestCount: contestResults.filter((item) => item.count === 0).length,
    ratedUserCount: currentRatings.size,
    rowCount,
    writeSkipped,
    writtenContestCount: willWrite ? ratedContestCount : 0,
    writtenUserCount: willWrite ? currentRatings.size : 0,
    writtenRowCount: willWrite ? rowCount : 0,
    timelineBlocked: !!blockedByContest,
    blockedByContest,
    outputLimit,
    resultContestCount: contestResults.length,
    returnedContestCount,
    omittedContestCount,
    hasMoreContests: omittedContestCount > 0,
    contests: contestResults.slice(0, returnedContestCount).map((item) => ({
      cid: item.cid,
      title: item.title,
      start: item.start,
      count: item.count,
      changes: includeChanges ? item.changes : undefined,
      skippedReason: item.skippedReason || null,
      pendingJudgementCount: Number(item.pendingJudgementCount || 0),
      pendingJudgementUserCount: Number(item.pendingJudgementUserCount || 0),
      pendingJudgementProblemCount: Number(item.pendingJudgementProblemCount || 0),
      submittedUserCount: Number(item.submittedUserCount || item.count || 0),
      minParticipantCount: Number(item.minParticipantCount || RATING_MIN_PARTICIPANTS),
      invalidLastSubmissionCount: Number(item.invalidLastSubmissionCount || 0),
      blockedByContest: item.blockedByContest || null,
    })),
    policy: RATING_POLICY,
  };
};

const rebuildAllContestRatings = async (options = {}) => {
  if (options.dryRun) return rebuildAllContestRatingsUnlocked(options);
  const result = await withContestRatingWriteLock((tx) => rebuildAllContestRatingsUnlocked({ ...options, runner: tx }));
  if (!result || result.locked || result.writeSkipped) return result;
  return { ...result, ...(await contestRatingStorageHealth({ recover: true })) };
};

const ratingCacheMismatchCount = async (runner) => {
  const row = await runner.one(
    `SELECT COUNT(*) AS cnt
       FROM userInfo u LEFT JOIN (${latestActiveRatingRowsSql}) latest ON latest.uid=u.uid
      WHERE COALESCE(u.rating,0)<>COALESCE(latest.newRating,0)`
  );
  return Number(row && row.cnt || 0);
};

const syncUserRatingsFromActiveHistory = async (runner) => {
  const ratingCacheMismatchBefore = await ratingCacheMismatchCount(runner);
  await runner.query(`DROP TEMPORARY TABLE IF EXISTS ${RATING_CACHE_TMP_TABLE}`);
  let activeHistoryUserCount = 0;
  try {
    await runner.query(`
      CREATE TEMPORARY TABLE ${RATING_CACHE_TMP_TABLE} (
        uid INT NOT NULL PRIMARY KEY,
        newRating INT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await runner.query(`INSERT INTO ${RATING_CACHE_TMP_TABLE} (uid,newRating) ${latestActiveRatingRowsSql}`);
    const active = await runner.one(`SELECT COUNT(*) AS cnt FROM ${RATING_CACHE_TMP_TABLE}`);
    activeHistoryUserCount = Number(active && active.cnt || 0);
    await runner.query(
      `UPDATE userInfo u
         LEFT JOIN ${RATING_CACHE_TMP_TABLE} latest ON latest.uid=u.uid
          SET u.rating=COALESCE(latest.newRating,0)
        WHERE COALESCE(u.rating,0)<>COALESCE(latest.newRating,0)`
    );
  } finally {
    await runner.query(`DROP TEMPORARY TABLE IF EXISTS ${RATING_CACHE_TMP_TABLE}`);
  }
  const ratingCacheMismatchAfter = await ratingCacheMismatchCount(runner);
  return {
    syncedUserCount: ratingCacheMismatchBefore,
    ratingCacheMismatchBefore,
    ratingCacheMismatchAfter,
    activeHistoryUserCount,
    activeRatedUserCount: activeHistoryUserCount,
  };
};

const deduplicateContestRatings = async (runner) => {
  const before = await duplicateRatingSummary(runner);
  if (!before.duplicateRatingRowCount) {
    return {
      ...before,
      deduplicatedRowCount: 0,
      duplicateRatingPairCountAfter: 0,
      duplicateRatingRowCountAfter: 0,
      duplicateRatingContestCountAfter: 0,
    };
  }

  await runner.query(`DROP TEMPORARY TABLE IF EXISTS ${RATING_DEDUP_TMP_TABLE}`);
  try {
    await runner.query(`
      CREATE TEMPORARY TABLE ${RATING_DEDUP_TMP_TABLE} (
        rid BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        cid INT NOT NULL,
        uid INT NOT NULL,
        rank INT NOT NULL,
        totalScore INT NOT NULL,
        usedTime INT NOT NULL,
        oldRating INT NOT NULL,
        newRating INT NOT NULL,
        delta INT NOT NULL,
        algorithm VARCHAR(40) NOT NULL,
        updateTime DATETIME NOT NULL,
        PRIMARY KEY (rid),
        KEY idx_pair (cid, uid)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await runner.query(`
      INSERT INTO ${RATING_DEDUP_TMP_TABLE}
        (cid,uid,rank,totalScore,usedTime,oldRating,newRating,delta,algorithm,updateTime)
      SELECT cid,uid,rank,totalScore,usedTime,oldRating,newRating,delta,algorithm,updateTime
        FROM contestRating
       ORDER BY cid ASC,uid ASC,updateTime DESC,rank ASC,totalScore DESC,usedTime ASC,newRating DESC,delta DESC,oldRating DESC,algorithm DESC
    `);
    await runner.query(`
      DELETE duplicateRow
        FROM ${RATING_DEDUP_TMP_TABLE} duplicateRow
        INNER JOIN ${RATING_DEDUP_TMP_TABLE} keepRow
          ON keepRow.cid=duplicateRow.cid
         AND keepRow.uid=duplicateRow.uid
         AND keepRow.rid<duplicateRow.rid
    `);
    await runner.query('DELETE FROM contestRating');
    await runner.query(`
      INSERT INTO contestRating
        (cid,uid,rank,totalScore,usedTime,oldRating,newRating,delta,algorithm,updateTime)
      SELECT cid,uid,rank,totalScore,usedTime,oldRating,newRating,delta,algorithm,updateTime
        FROM ${RATING_DEDUP_TMP_TABLE}
       ORDER BY cid ASC,rank ASC,uid ASC
    `);
  } finally {
    await runner.query(`DROP TEMPORARY TABLE IF EXISTS ${RATING_DEDUP_TMP_TABLE}`);
  }

  const after = await duplicateRatingSummary(runner);
  return {
    ...before,
    deduplicatedRowCount: before.duplicateRatingRowCount,
    duplicateRatingPairCountAfter: after.duplicateRatingPairCount,
    duplicateRatingRowCountAfter: after.duplicateRatingRowCount,
    duplicateRatingContestCountAfter: after.duplicateRatingContestCount,
  };
};

const contestRatingStorageHealth = async (options = {}) => {
  const recovery = options.recover ? await ensureContestRatingPrimaryKey() : {};
  const auxiliaryRecovery = options.recover ? await ensureContestRatingAuxiliaryIndexes() : {};
  const [uniqueConstraint, auxiliaryIndex] = await Promise.all([
    contestRatingUniqueConstraintStatus(),
    contestRatingAuxiliaryIndexStatus(),
  ]);
  return {
    ...recovery,
    ...auxiliaryRecovery,
    ratingUniqueConstraintReady: !!uniqueConstraint.uniqueConstraintReady,
    ratingPrimaryKeyCoversPair: !!uniqueConstraint.primaryKeyCoversPair,
    ratingPairUniqueConstraintExists: !!uniqueConstraint.pairUniqueConstraintExists,
    ratingPrimaryKeyWrongColumns: !!uniqueConstraint.primaryKeyWrongColumns,
    ratingPrimaryKeyColumns: uniqueConstraint.primaryKeyColumns || [],
    ratingUniqueConstraintDuplicatePairCount: Number(uniqueConstraint.primaryKeySkippedDuplicatePairCount || 0),
    ratingUniqueConstraintNullKeyRowCount: Number(uniqueConstraint.primaryKeySkippedNullKeyRowCount || 0),
    ratingAuxiliaryIndexesReady: !!auxiliaryIndex.auxiliaryIndexesReady,
    ratingUidIndexReady: !!auxiliaryIndex.uidIndexReady,
    ratingCidRankIndexReady: !!auxiliaryIndex.cidRankIndexReady,
    ratingUidIndexNames: auxiliaryIndex.uidIndexNames || [],
    ratingCidRankIndexNames: auxiliaryIndex.cidRankIndexNames || [],
  };
};

const firstRatingConflict = (conflicts) => conflicts && conflicts.length ? {
  cid: conflicts[0].cid,
  uid: conflicts[0].uid,
  username: conflicts[0].username,
  title: conflicts[0].title,
  start: Format(conflicts[0].start),
} : null;

const ratingInvalidLastSubmissionText = (result) => {
  const count = Number(result && result.invalidLastSubmissionCount || 0);
  return count ? `，另有 ${count} 条无效最后提交未计入` : '';
};

const ratingPendingJudgementMessage = (result, suffix = '暂不能结算 Rating') => {
  const details = [];
  const userCount = Number(result && result.pendingJudgementUserCount || 0);
  const problemCount = Number(result && result.pendingJudgementProblemCount || 0);
  if (userCount) details.push(`${userCount} 名用户`);
  if (problemCount) details.push(`${problemCount} 题`);
  const detailText = details.length ? `（${details.join(' / ')}）` : '';
  return `还有 ${Number(result && result.pendingJudgementCount || 0)} 个最后提交尚未完成评测${detailText}${ratingInvalidLastSubmissionText(result)}，${suffix}`;
};

const ratingTimelineBlockedMessage = (result) => {
  const first = firstRatingConflict(result && result.conflicts) || {};
  const title = first.title ? `（${first.title}）` : '';
  const details = [];
  if (result && result.sampleInsufficient) {
    details.push(`当前有效提交人数 ${Number(result.submittedUserCount || 0)}/${Number(result.minParticipantCount || RATING_MIN_PARTICIPANTS)}`);
  }
  const invalidCount = Number(result && result.invalidLastSubmissionCount || 0);
  if (invalidCount) details.push(`另有 ${invalidCount} 条无效最后提交未计入`);
  const detailText = details.length ? `；${details.join('，')}` : '';
  return `已有后续比赛 Rating 结算${title}，请按时间顺序重建 Rating${detailText}`;
};

const ratingWriteResultPayload = async (result, options = {}) => {
  const payload = {
    applied: !!(result && result.applied),
    rebuilt: !!(result && result.rebuilt),
    blocked: !!(result && result.blocked),
    locked: !!(result && result.locked),
    pendingJudgement: !!(result && result.pendingJudgement),
    pendingJudgementCount: Number(result && result.pendingJudgementCount || 0),
    pendingJudgementUserCount: Number(result && result.pendingJudgementUserCount || 0),
    pendingJudgementProblemCount: Number(result && result.pendingJudgementProblemCount || 0),
    sampleInsufficient: !!(result && result.sampleInsufficient),
    submittedUserCount: Number(result && result.submittedUserCount || 0),
    minParticipantCount: Number(result && result.minParticipantCount || RATING_MIN_PARTICIPANTS),
    invalidLastSubmissionCount: Number(result && result.invalidLastSubmissionCount || 0),
    count: Array.isArray(result && result.changes) ? result.changes.length : 0,
    syncedUserCount: Number(result && result.sync && result.sync.syncedUserCount || 0),
    ratingCacheMismatchAfter: Number(result && result.sync && result.sync.ratingCacheMismatchAfter || 0),
    unrated: !!(result && result.unrated),
  };
  if (options.includeConflict) payload.conflict = firstRatingConflict(result && result.conflicts);
  if (options.includeStorageHealth && result && !result.locked) {
    Object.assign(payload, await contestRatingStorageHealth({ recover: true }));
  }
  return payload;
};

const cleanupStaleContestRatings = async () => {
  const result = await withContestRatingWriteLock(async (tx) => {
    await ensureContestRatingSchema();
    const stale = await tx.one(`SELECT COUNT(*) AS rowCnt,COUNT(DISTINCT cr.cid) AS contestCnt ${staleRatingRowsFrom}`);
    const staleRowCount = Number(stale && stale.rowCnt || 0);
    const staleContestCount = Number(stale && stale.contestCnt || 0);
    if (staleRowCount) {
      await tx.query(
        `DELETE cr
           FROM contestRating cr LEFT JOIN contest c ON c.cid=cr.cid
           LEFT JOIN userInfo u ON u.uid=cr.uid
          WHERE c.cid IS NULL OR u.uid IS NULL OR c.done<>1 OR c.ratingEnabled<>1`
      );
    }
    const duplicateCleanup = await deduplicateContestRatings(tx);
    const sync = await syncUserRatingsFromActiveHistory(tx);

    return { deletedRowCount: staleRowCount, staleContestCount, ...duplicateCleanup, ...sync };
  });
  if (!result || result.locked) return result;
  return {
    ...result,
    ...(await contestRatingStorageHealth({ recover: true })),
  };
};

const syncContestRatingCache = async () => withContestRatingWriteLock(async (tx) => {
  await ensureContestRatingSchema();
  return syncUserRatingsFromActiveHistory(tx);
});

const ratingDriftSummary = async (limit = RATING_DRIFT_REPORT_LIMIT) => {
  await ensureContestRatingSchema();
  const audit = await rebuildAllContestRatings({ dryRun: true, includeChanges: true });
  const drift = [];
  let checkedContestCount = 0;
  let skippedPendingContestCount = 0;
  let driftContestCount = 0;

  for (const contest of audit.contests) {
    if (contest.skippedReason === 'pendingJudgement') {
      skippedPendingContestCount += 1;
      continue;
    }
    if (contest.skippedReason === 'timelineBlocked') continue;

    const existing = await ratingRowsForContest(contest.cid);
    if (!existing.length) continue;

    checkedContestCount += 1;
    const changes = contest.changes || [];
    const comparison = compareContestRatingChanges(existing, changes);
    if (!comparison.drifted) continue;

    driftContestCount += 1;
    if (drift.length < limit) {
      drift.push({
        cid: contest.cid,
        title: contest.title,
        start: contest.start,
        rowCount: existing.length,
        expectedRowCount: changes.length,
        reason: comparison.reason,
        diffUserCount: comparison.diffUserCount,
        firstMismatch: comparison.firstMismatch,
      });
    }
  }

  return {
    checkedContestCount,
    skippedPendingContestCount,
    timelineBlocked: !!audit.timelineBlocked,
    blockedByContest: audit.blockedByContest,
    driftContestCount,
    drift,
  };
};

// 主审核流程：可不可以查看比赛中的题目/提交。返回 { contest, status, isReged, canView } 或 null（无此比赛）
const loadContestForView = async (req, cid) => {
  const contest = await getContest(cid);
  if (!contest) return null;
  contest.status = contestStatus(contest);
  const isReged = await isReg(req.session.uid, cid);
  const canView =
    (contest.status === 3 && (contest.isPublic || isReged)) ||
    (isReged && contest.status > 0) ||
    (await canManageContest(req, contest.cid));
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
    await ensureContestRatingSchema();
    const { cid, info } = req.body;
    const contest = await getContest(cid);
    if (!contest) return fail(res, '无此比赛');
    if (!(await canManageContest(req, cid)))
      return fail(res, '你只能修改自己的比赛');
    if (contest.done) return fail(res, '比赛已经结束');
    if (!info.title || !info.start || !info.length || !info.type) return fail(res, '请确认信息完善');
    if (info.title.length > 30) return fail(res, '比赛名称最长30个字符');
    if (info.type > 1) return fail(res, '非法比赛类型');
    info.type = ctypeToIndex[info.type];
    if (info.isPublic !== true && info.isPublic !== false) return fail(res, '非法isPublic参数');
    const ratingEnabled = info.ratingEnabled === undefined
      ? !!contest.ratingEnabled
      : !!info.ratingEnabled;

    const r = await db.query(
      'UPDATE contest SET title=?,description=?,start=?,length=?,type=?,isPublic=?,lang=?,ratingEnabled=? WHERE cid=?',
      [info.title, info.description, new Date(info.start), info.length, info.type, info.isPublic, info.lang, ratingEnabled ? 1 : 0, cid]
    );
    if (!r.affectedRows) return fail(res, 'error');
    return ok(res);
  }),
];

exports.getContestList = handler(async (req, res) => {
  await ensureContestRatingSchema();
  const { offset, limit } = paginate(req);
  const visibility = contestListVisibility(req);
  const list = await db.query(
    'SELECT c.cid,c.title,c.start,c.length,c.isPublic,c.type,c.host,c.done,c.ratingEnabled,u.name as hostName ' +
    `FROM contest c INNER JOIN userInfo u ON u.uid = c.host ${visibility.where} ORDER BY c.start DESC LIMIT ?,?`,
    [...visibility.params, offset, limit]
  );
  for (const c of list) {
    const status = contestStatus(c);
    c.type = ctype[c.type];
    c.status = cstatus[status];
    c.start = Format(c.start);
    c.ratingEnabled = !!c.ratingEnabled;
    await attachContestRatingStatus(c, status);
    c.playerCnt = await playerCnt(c.cid);
  }
  const cnt = await db.one(`SELECT COUNT(*) as total FROM contest c ${visibility.where}`, visibility.params);
  return ok(res, { total: cnt.total, data: list });
});

exports.getContestInfo = handler(async (req, res) => {
  await ensureContestRatingSchema();
  const { cid } = req.body;
  const contest = await db.one(
    'SELECT c.cid,c.title,c.start,c.length,c.isPublic,c.type,c.host,c.description,c.lang,c.done,c.ratingEnabled,u.name as hostName ' +
    'FROM contest c INNER JOIN userInfo u ON u.uid = c.host WHERE cid=?',
    [cid]
  );
  if (!contest) return fail(res, '无此比赛');

  contest.isReg = await isReg(req.session.uid, contest.cid);
  const isManager = await canManageContest(req, contest.cid);
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
    manage: isManager,
  };
  contest.type = ctype[contest.type];
  contest.ratingEnabled = !!contest.ratingEnabled;
  await attachContestRatingStatus(contest, status);
  contest.start = Format(contest.start);
  contest.status = cstatus[status];
  return ok(res, { data: contest });
});

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

exports.recalculateContestRating = handler(async (req, res) => {
  await ensureContestRatingSchema();
  const { cid } = req.body;
  const contest = await getContest(cid);
  if (!contest) return fail(res, '无此比赛');
  if (!(await canManageContest(req, cid))) return fail(res, '你只能修改自己的比赛');
  if (contestStatus(contest) !== 3) return fail(res, '比赛尚未结束');
  if (!contest.ratingEnabled) return fail(res, '该比赛未开启 Rating');

  const result = await recalculateContestRating(contest);
  if (failIfRatingLocked(res, result)) return null;
  if (result.pendingJudgement) {
    return fail(res, ratingPendingJudgementMessage(result));
  }
  if (result.blocked) {
    return fail(res, ratingTimelineBlockedMessage(result));
  }
  return ok(res, {
    rating: await ratingWriteResultPayload(result, { includeStorageHealth: true }),
  });
});

exports.settleContestRating = [
  requirePermission('user.role.admin'),
  handler(async (req, res) => {
    await ensureContestRatingSchema();
    const { cid } = req.body;
    const contest = await getContest(cid);
    if (!contest) return fail(res, '无此比赛');
    if (contestStatus(contest) !== 3) return fail(res, '比赛尚未结束');
    if (!contest.ratingEnabled) return fail(res, '该比赛未开启 Rating');

    const result = await recalculateContestRating(contest);
    if (failIfRatingLocked(res, result)) return null;
    if (result.pendingJudgement) {
      return fail(res, ratingPendingJudgementMessage(result));
    }
    if (result.blocked) {
      return fail(res, ratingTimelineBlockedMessage(result));
    }
    return ok(res, {
      rating: await ratingWriteResultPayload(result, { includeStorageHealth: true }),
    });
  }),
];

exports.previewRating = handler(async (req, res) => {
  await ensureContestRatingSchema();
  const { cid } = req.body;
  const contest = await getContest(cid);
  if (!contest) return fail(res, '无此比赛');
  if (!(await canManageContest(req, cid)) && !canManageRatingSystem(req)) {
    return fail(res, '你只能修改自己的比赛');
  }

  const result = await previewContestRatingChanges(contest);
  const detailLimit = ratingPreviewDetailLimit(req);
  const rows = result.changes.map((row) => ({
    uid: Number(row.uid),
    username: row.username,
    rank: Number(row.rank),
    totalScore: Number(row.totalScore || 0),
    usedTime: Number(row.usedTime || 0),
    oldRating: Number(row.oldRating || 0),
    newRating: Number(row.newRating || 0),
    delta: Number(row.delta || 0),
  }));
  const returnedRows = rows.slice(0, detailLimit);
  return ok(res, {
    rating: {
      policy: RATING_POLICY,
      count: rows.length,
      detailLimit,
      returnedCount: returnedRows.length,
      omittedCount: rows.length - returnedRows.length,
      hasMoreChanges: rows.length > returnedRows.length,
      settled: result.settled,
      unrated: result.unrated,
      blocked: !!result.blocked,
      sampleInsufficient: !!result.sampleInsufficient,
      submittedUserCount: Number(result.submittedUserCount || 0),
      minParticipantCount: Number(result.minParticipantCount || RATING_MIN_PARTICIPANTS),
      invalidLastSubmissionCount: Number(result.invalidLastSubmissionCount || 0),
      pendingJudgement: !!result.pendingJudgement,
      pendingJudgementCount: Number(result.pendingJudgementCount || 0),
      pendingJudgementUserCount: Number(result.pendingJudgementUserCount || 0),
      pendingJudgementProblemCount: Number(result.pendingJudgementProblemCount || 0),
      drifted: !!result.drifted,
      driftReason: result.driftReason || null,
      driftDiffUserCount: Number(result.driftDiffUserCount || 0),
      driftFirstMismatch: result.driftFirstMismatch || null,
      conflict: result.conflicts && result.conflicts.length ? {
        cid: result.conflicts[0].cid,
        uid: result.conflicts[0].uid,
        username: result.conflicts[0].username,
        title: result.conflicts[0].title,
        start: Format(result.conflicts[0].start),
      } : null,
      data: returnedRows,
    },
  });
});

exports.rebuildContestRatings = [
  requirePermission('user.role.admin'),
  handler(async (req, res) => {
    const result = await rebuildAllContestRatings({ outputLimit: ratingAdminSampleLimit(req) });
    if (failIfRatingLocked(res, result)) return null;
    return ok(res, { rating: result });
  }),
];

exports.previewContestRatingRebuild = [
  requirePermission('user.role.admin'),
  handler(async (req, res) => {
    const result = await rebuildAllContestRatings({ dryRun: true, outputLimit: ratingAdminSampleLimit(req) });
    return ok(res, { rating: result });
  }),
];

exports.cleanupStaleContestRatings = [
  requirePermission('user.role.admin'),
  handler(async (req, res) => {
    const result = await cleanupStaleContestRatings();
    if (failIfRatingLocked(res, result)) return null;
    return ok(res, { cleanup: result });
  }),
];

exports.syncContestRatingCache = [
  requirePermission('user.role.admin'),
  handler(async (req, res) => {
    const result = await syncContestRatingCache();
    if (failIfRatingLocked(res, result)) return null;
    return ok(res, { sync: result });
  }),
];

exports.getRatingSystemStats = [
  requirePermission('user.role.admin'),
  handler(async (req, res) => {
    await ensureContestRatingSchema();
    await ensureContestRatingAuxiliaryIndexes();
    const sampleLimit = ratingAdminSampleLimit(req);
    const [
      doneContests,
      ratingEnabledContests,
      ratedContests,
      ratingRows,
      ratedUsers,
      activeRatedUsers,
      inactiveRatedUsers,
      currentRatedUsers,
      activeCurrentRatedUsers,
      inactiveCurrentRatedUsers,
      staleRows,
      nullKeyRows,
      duplicateStats,
      uniqueConstraintStatus,
      auxiliaryIndexStatus,
      ratingCacheMismatches,
      activeRatingCacheMismatches,
      inactiveRatingCacheMismatches,
      pendingRatedContests,
      sampleInsufficientContests,
      pendingJudgements,
      invalidLastSubmissionStats,
    ] = await Promise.all([
      db.one('SELECT COUNT(*) AS cnt FROM contest WHERE done=1'),
      db.one('SELECT COUNT(*) AS cnt FROM contest WHERE done=1 AND ratingEnabled=1'),
      db.one(`SELECT COUNT(DISTINCT cr.cid) AS cnt ${activeRatingRowsFrom}`),
      db.one(`SELECT COUNT(*) AS cnt ${activeRatingRowsFrom}`),
      db.one(`SELECT COUNT(DISTINCT cr.uid) AS cnt ${activeRatingRowsFrom}`),
      db.one(`SELECT COUNT(DISTINCT cr.uid) AS cnt ${activeRatingRowsFrom} AND u.inUse=1`),
      db.one(`SELECT COUNT(DISTINCT cr.uid) AS cnt ${activeRatingRowsFrom} AND u.inUse<>1`),
      db.one('SELECT COUNT(*) AS cnt FROM userInfo WHERE rating>0'),
      db.one('SELECT COUNT(*) AS cnt FROM userInfo WHERE rating>0 AND inUse=1'),
      db.one('SELECT COUNT(*) AS cnt FROM userInfo WHERE rating>0 AND inUse<>1'),
      db.one(`SELECT COUNT(*) AS rowCnt,COUNT(DISTINCT cr.cid) AS contestCnt ${staleRatingRowsFrom}`),
      db.one('SELECT COUNT(*) AS cnt FROM contestRating WHERE cid IS NULL OR uid IS NULL'),
      duplicateRatingSummary(),
      contestRatingUniqueConstraintStatus(),
      contestRatingAuxiliaryIndexStatus(),
      db.one(
        `SELECT COUNT(*) AS cnt
           FROM userInfo u LEFT JOIN (${latestActiveRatingRowsSql}) latest ON latest.uid=u.uid
          WHERE COALESCE(u.rating,0)<>COALESCE(latest.newRating,0)`
      ),
      db.one(
        `SELECT COUNT(*) AS cnt
           FROM userInfo u LEFT JOIN (${latestActiveRatingRowsSql}) latest ON latest.uid=u.uid
          WHERE u.inUse=1 AND COALESCE(u.rating,0)<>COALESCE(latest.newRating,0)`
      ),
      db.one(
        `SELECT COUNT(*) AS cnt
           FROM userInfo u LEFT JOIN (${latestActiveRatingRowsSql}) latest ON latest.uid=u.uid
          WHERE u.inUse<>1 AND COALESCE(u.rating,0)<>COALESCE(latest.newRating,0)`
      ),
      db.one(`SELECT COUNT(*) AS cnt ${pendingRatedContestFrom}`),
      db.one(`SELECT COUNT(*) AS cnt ${sampleInsufficientRatedContestFrom}`),
      db.one(
        `SELECT COUNT(*) AS rowCnt,COUNT(DISTINCT cls.cid) AS contestCnt
         ${validContestLastSubmissionFrom()}
         INNER JOIN contest c ON c.cid=cls.cid
         INNER JOIN (
${submittedUserCountByContestSql('cls2', 'cp2', 'u2', 's2')}
           HAVING COUNT(DISTINCT cls2.uid)>=${RATING_MIN_PARTICIPANTS}
         ) submitted ON submitted.cid=c.cid
          WHERE c.done=1 AND c.ratingEnabled=1 AND s.judgeResult IN (?)`,
        [RATING_PENDING_RESULTS]
      ),
      db.one(`SELECT COUNT(*) AS rowCnt,COUNT(DISTINCT cls.cid) AS contestCnt ${invalidContestLastSubmissionFrom()}`),
    ]);
    const [
      recent,
      stale,
      duplicates,
      staleReasonCounts,
      pending,
      sampleInsufficient,
      judging,
      invalidLastSubmissionReasonCounts,
      invalidLastSubmissionRows,
      cacheMismatchReasonCounts,
      cacheMismatchRows,
      ratingDrift,
    ] = await Promise.all([
      db.query(
        `SELECT cr.cid,c.title,c.start,COUNT(*) AS count,MAX(cr.updateTime) AS updateTime
	          FROM contestRating cr
	          INNER JOIN contest c ON c.cid=cr.cid
	          INNER JOIN userInfo u ON u.uid=cr.uid
	         WHERE c.done=1 AND c.ratingEnabled=1
	          GROUP BY cr.cid,c.title,c.start
	          ORDER BY updateTime DESC
	          LIMIT ?`,
        [sampleLimit]
	      ),
	      db.query(
            `SELECT cr.cid,c.title,c.start,c.done,c.ratingEnabled,COUNT(*) AS rowCount,
                    CASE
                  WHEN cr.cid IS NULL OR cr.uid IS NULL THEN 'nullKey'
                  WHEN c.cid IS NULL THEN 'missingContest'
                  WHEN u.uid IS NULL THEN 'missingUser'
                  WHEN c.done<>1 THEN 'contestReopened'
                  WHEN c.ratingEnabled<>1 THEN 'contestUnrated'
                  ELSE 'unknown'
                END AS reason
           FROM contestRating cr LEFT JOIN contest c ON c.cid=cr.cid
           LEFT JOIN userInfo u ON u.uid=cr.uid
	          WHERE c.cid IS NULL OR u.uid IS NULL OR c.done<>1 OR c.ratingEnabled<>1
	          GROUP BY cr.cid,c.title,c.start,c.done,c.ratingEnabled,reason
	          ORDER BY rowCount DESC,cr.cid DESC
	          LIMIT ?`,
	        [sampleLimit]
		      ),
	      duplicateRatingRowsSample(sampleLimit),
	      db.query(
        `SELECT CASE
                  WHEN cr.cid IS NULL OR cr.uid IS NULL THEN 'nullKey'
                  WHEN c.cid IS NULL THEN 'missingContest'
                  WHEN u.uid IS NULL THEN 'missingUser'
                  WHEN c.done<>1 THEN 'contestReopened'
                  WHEN c.ratingEnabled<>1 THEN 'contestUnrated'
                  ELSE 'unknown'
                END AS reason,
                COUNT(*) AS rowCount,
                COUNT(DISTINCT cr.cid) AS contestCount
           FROM contestRating cr LEFT JOIN contest c ON c.cid=cr.cid
           LEFT JOIN userInfo u ON u.uid=cr.uid
          WHERE c.cid IS NULL OR u.uid IS NULL OR c.done<>1 OR c.ratingEnabled<>1
          GROUP BY reason
          ORDER BY rowCount DESC`
      ),
      db.query(
        `SELECT c.cid,c.title,c.start,submitted.submittedUserCount,
                (
                  SELECT COUNT(*)
                    ${validContestLastSubmissionFrom('cls2', 'cp2', 'u2', 's2')}
                   WHERE cls2.cid=c.cid AND s2.judgeResult IN (?)
                ) AS pendingJudgementCount,
                (
                  SELECT COUNT(DISTINCT cls3.uid)
                    ${validContestLastSubmissionFrom('cls3', 'cp3', 'u3', 's3')}
                   WHERE cls3.cid=c.cid AND s3.judgeResult IN (?)
                ) AS pendingUserCount,
                (
                  SELECT COUNT(DISTINCT s4.pid)
                    ${validContestLastSubmissionFrom('cls4', 'cp4', 'u4', 's4')}
                   WHERE cls4.cid=c.cid AND s4.judgeResult IN (?)
                ) AS pendingProblemCount
	           ${pendingRatedContestFrom}
	          ORDER BY c.start DESC,c.cid DESC
	          LIMIT ?`,
        [RATING_PENDING_RESULTS, RATING_PENDING_RESULTS, RATING_PENDING_RESULTS, sampleLimit]
	      ),
	      db.query(
	        `SELECT c.cid,c.title,c.start,COALESCE(submitted.submittedUserCount,0) AS submittedUserCount
	           ${sampleInsufficientRatedContestFrom}
	          ORDER BY c.start DESC,c.cid DESC
	          LIMIT ?`,
        [sampleLimit]
	      ),
      db.query(
        `SELECT c.cid,c.title,c.start,
                COUNT(*) AS pendingJudgementCount,
                COUNT(DISTINCT cls.uid) AS pendingUserCount,
                COUNT(DISTINCT s.pid) AS pendingProblemCount,
                (
                  SELECT COUNT(DISTINCT cls2.uid)
                    ${validContestLastSubmissionFrom('cls2', 'cp2', 'u2', 's2')}
                   WHERE cls2.cid=c.cid
                ) AS submittedUserCount,
                (
                 SELECT COUNT(*)
                    FROM contestRating cr INNER JOIN userInfo ru ON ru.uid=cr.uid
                   WHERE cr.cid=c.cid
                ) AS ratingRowCount
           FROM contest c
           INNER JOIN (
${submittedUserCountByContestSql('cls2', 'cp2', 'u2', 's2')}
             HAVING COUNT(DISTINCT cls2.uid)>=${RATING_MIN_PARTICIPANTS}
           ) submitted ON submitted.cid=c.cid
           INNER JOIN contestLastSubmission cls ON cls.cid=c.cid
           INNER JOIN contestPlayer cp ON cp.cid=cls.cid AND cp.uid=cls.uid
           INNER JOIN userInfo u ON u.uid=cls.uid
           INNER JOIN submission s ON s.sid=cls.sid AND s.cid=cls.cid AND s.uid=cls.uid AND s.pid=cls.pid
	          WHERE c.done=1 AND c.ratingEnabled=1 AND s.judgeResult IN (?)
	          GROUP BY c.cid,c.title,c.start
	          ORDER BY c.start ASC,c.cid ASC
	          LIMIT ?`,
        [RATING_PENDING_RESULTS, sampleLimit]
	      ),
      db.query(
        `SELECT ${invalidContestLastSubmissionReasonExpr()} AS reason,
                COUNT(*) AS rowCount,
                COUNT(DISTINCT cls.cid) AS contestCount,
                COUNT(DISTINCT cls.uid) AS userCount
           ${invalidContestLastSubmissionFrom()}
          GROUP BY reason
          ORDER BY rowCount DESC`
      ),
      db.query(
        `SELECT cls.cid,c.title,c.start,cls.uid,u.name AS username,cls.pid,cls.sid,
                ${invalidContestLastSubmissionReasonExpr()} AS reason,
                CASE WHEN cp.uid IS NULL THEN 1 ELSE 0 END AS notContestPlayer,
                CASE WHEN u.uid IS NULL THEN 1 ELSE 0 END AS missingUser,
                CASE WHEN s.sid IS NULL THEN 1 ELSE 0 END AS missingSubmission
           ${invalidContestLastSubmissionFrom()}
          ORDER BY c.start DESC,cls.cid DESC,cls.uid ASC,cls.pid ASC
          LIMIT ?`,
        [sampleLimit]
      ),
      db.query(
        `SELECT CASE
                  WHEN COALESCE(u.rating,0)>0 AND latest.newRating IS NULL THEN 'orphanCache'
                  WHEN COALESCE(u.rating,0)=0 AND latest.newRating IS NOT NULL THEN 'missingCache'
                  WHEN COALESCE(u.rating,0)>COALESCE(latest.newRating,0) THEN 'cacheHigher'
                  WHEN COALESCE(u.rating,0)<COALESCE(latest.newRating,0) THEN 'cacheLower'
                  ELSE 'unknown'
	                END AS reason,
	                COUNT(*) AS userCount,
	                SUM(CASE WHEN u.inUse=1 THEN 1 ELSE 0 END) AS activeUserCount,
	                SUM(CASE WHEN u.inUse<>1 THEN 1 ELSE 0 END) AS inactiveUserCount
	           FROM userInfo u LEFT JOIN (${latestActiveRatingRowsSql}) latest ON latest.uid=u.uid
	          WHERE COALESCE(u.rating,0)<>COALESCE(latest.newRating,0)
	          GROUP BY reason
          ORDER BY userCount DESC`
      ),
      db.query(
	        `SELECT u.uid,u.name,u.inUse,
	                COALESCE(u.rating,0) AS cachedRating,
	                COALESCE(latest.newRating,0) AS historyRating
		   FROM userInfo u LEFT JOIN (${latestActiveRatingRowsSql}) latest ON latest.uid=u.uid
		  WHERE COALESCE(u.rating,0)<>COALESCE(latest.newRating,0)
		  ORDER BY (u.inUse=1) DESC,ABS(COALESCE(u.rating,0)-COALESCE(latest.newRating,0)) DESC,u.uid ASC
		  LIMIT ?`,
        [sampleLimit]
      ),
      ratingDriftSummary(sampleLimit),
    ]);
    return ok(res, {
      limit: sampleLimit,
      stats: {
        doneContestCount: Number(doneContests.cnt || 0),
        ratingEnabledContestCount: Number(ratingEnabledContests.cnt || 0),
        ratedContestCount: Number(ratedContests.cnt || 0),
        ratingRowCount: Number(ratingRows.cnt || 0),
        ratedUserCount: Number(ratedUsers.cnt || 0),
        activeRatedUserCount: Number(activeRatedUsers.cnt || 0),
        inactiveRatedUserCount: Number(inactiveRatedUsers.cnt || 0),
        currentRatedUserCount: Number(currentRatedUsers.cnt || 0),
        activeCurrentRatedUserCount: Number(activeCurrentRatedUsers.cnt || 0),
        inactiveCurrentRatedUserCount: Number(inactiveCurrentRatedUsers.cnt || 0),
        staleRatingRowCount: Number(staleRows.rowCnt || 0),
        staleRatingContestCount: Number(staleRows.contestCnt || 0),
        nullKeyRatingRowCount: Number(nullKeyRows.cnt || 0),
        duplicateRatingPairCount: Number(duplicateStats.duplicateRatingPairCount || 0),
        duplicateRatingRowCount: Number(duplicateStats.duplicateRatingRowCount || 0),
        duplicateRatingContestCount: Number(duplicateStats.duplicateRatingContestCount || 0),
        ratingUniqueConstraintReady: !!uniqueConstraintStatus.uniqueConstraintReady,
        ratingPrimaryKeyCoversPair: !!uniqueConstraintStatus.primaryKeyCoversPair,
        ratingPairUniqueConstraintExists: !!uniqueConstraintStatus.pairUniqueConstraintExists,
        ratingPrimaryKeyWrongColumns: !!uniqueConstraintStatus.primaryKeyWrongColumns,
        ratingPrimaryKeyColumns: uniqueConstraintStatus.primaryKeyColumns || [],
        ratingUniqueConstraintDuplicatePairCount: Number(uniqueConstraintStatus.primaryKeySkippedDuplicatePairCount || 0),
        ratingUniqueConstraintNullKeyRowCount: Number(uniqueConstraintStatus.primaryKeySkippedNullKeyRowCount || 0),
        ratingAuxiliaryIndexesReady: !!auxiliaryIndexStatus.auxiliaryIndexesReady,
        ratingUidIndexReady: !!auxiliaryIndexStatus.uidIndexReady,
        ratingCidRankIndexReady: !!auxiliaryIndexStatus.cidRankIndexReady,
        ratingUidIndexNames: auxiliaryIndexStatus.uidIndexNames || [],
        ratingCidRankIndexNames: auxiliaryIndexStatus.cidRankIndexNames || [],
        ratingCacheMismatchCount: Number(ratingCacheMismatches.cnt || 0),
        activeRatingCacheMismatchCount: Number(activeRatingCacheMismatches.cnt || 0),
        inactiveRatingCacheMismatchCount: Number(inactiveRatingCacheMismatches.cnt || 0),
        pendingRatedContestCount: Number(pendingRatedContests.cnt || 0),
        sampleInsufficientContestCount: Number(sampleInsufficientContests.cnt || 0),
        pendingJudgementCount: Number(pendingJudgements.rowCnt || 0),
        pendingJudgementContestCount: Number(pendingJudgements.contestCnt || 0),
        invalidLastSubmissionCount: Number(invalidLastSubmissionStats.rowCnt || 0),
        invalidLastSubmissionContestCount: Number(invalidLastSubmissionStats.contestCnt || 0),
        ratingDriftContestCount: Number(ratingDrift.driftContestCount || 0),
        ratingDriftCheckedContestCount: Number(ratingDrift.checkedContestCount || 0),
        ratingDriftSkippedPendingContestCount: Number(ratingDrift.skippedPendingContestCount || 0),
        ratingDriftTimelineBlocked: !!ratingDrift.timelineBlocked,
        ratingDriftBlockedByContest: ratingDrift.blockedByContest || null,
      },
      recent: recent.map((row) => ({
        cid: row.cid,
        title: row.title,
        start: Format(row.start),
        count: Number(row.count || 0),
        updateTime: Format(row.updateTime),
      })),
	      stale: stale.map((row) => ({
	        cid: row.cid,
	        title: row.title || (row.reason === 'nullKey' ? '主键为空记录' : '已删除比赛'),
        start: row.start ? Format(row.start) : null,
	        rowCount: Number(row.rowCount || 0),
	        reason: row.reason || 'unknown',
	      })),
	      duplicates: duplicates.map((row) => ({
	        cid: row.cid,
	        title: row.title || '已删除比赛',
	        start: row.start ? Format(row.start) : null,
	        uid: row.uid,
	        username: row.username || '已删除用户',
	        rowCount: Number(row.rowCount || 0),
	        duplicateRowCount: Number(row.duplicateRowCount || 0),
	        firstUpdateTime: row.firstUpdateTime ? Format(row.firstUpdateTime) : null,
	        lastUpdateTime: row.lastUpdateTime ? Format(row.lastUpdateTime) : null,
	      })),
	      staleReasonCounts: staleReasonCounts.map((row) => ({
	        reason: row.reason || 'unknown',
        rowCount: Number(row.rowCount || 0),
        contestCount: Number(row.contestCount || 0),
      })),
	      cacheMismatchReasonCounts: cacheMismatchReasonCounts.map((row) => ({
	        reason: row.reason || 'unknown',
	        userCount: Number(row.userCount || 0),
	        activeUserCount: Number(row.activeUserCount || 0),
	        inactiveUserCount: Number(row.inactiveUserCount || 0),
	      })),
      pending: pending.map((row) => ({
        cid: row.cid,
        title: row.title,
        start: Format(row.start),
        submittedUserCount: Number(row.submittedUserCount || 0),
        pendingJudgementCount: Number(row.pendingJudgementCount || 0),
        pendingUserCount: Number(row.pendingUserCount || 0),
        pendingProblemCount: Number(row.pendingProblemCount || 0),
      })),
      sampleInsufficient: sampleInsufficient.map((row) => ({
        cid: row.cid,
        title: row.title,
        start: Format(row.start),
        submittedUserCount: Number(row.submittedUserCount || 0),
        minParticipantCount: RATING_MIN_PARTICIPANTS,
      })),
      judging: judging.map((row) => ({
        cid: row.cid,
        title: row.title,
        start: Format(row.start),
        pendingJudgementCount: Number(row.pendingJudgementCount || 0),
        pendingUserCount: Number(row.pendingUserCount || 0),
        pendingProblemCount: Number(row.pendingProblemCount || 0),
        submittedUserCount: Number(row.submittedUserCount || 0),
        ratingRowCount: Number(row.ratingRowCount || 0),
      })),
      invalidLastSubmissionReasonCounts: invalidLastSubmissionReasonCounts.map((row) => ({
        reason: row.reason || 'unknown',
        rowCount: Number(row.rowCount || 0),
        contestCount: Number(row.contestCount || 0),
        userCount: Number(row.userCount || 0),
      })),
      invalidLastSubmissions: invalidLastSubmissionRows.map((row) => ({
        cid: row.cid,
        title: row.title,
        start: Format(row.start),
        uid: row.uid,
        username: row.username || '已删除用户',
        pid: row.pid,
        sid: row.sid,
        reason: row.reason || 'unknown',
        notContestPlayer: !!Number(row.notContestPlayer),
        missingUser: !!Number(row.missingUser),
        missingSubmission: !!Number(row.missingSubmission),
      })),
      cacheMismatches: cacheMismatchRows.map((row) => ({
	        uid: row.uid,
	        username: row.name,
	        inUse: !!Number(row.inUse),
	        cachedRating: Number(row.cachedRating || 0),
        historyRating: Number(row.historyRating || 0),
        delta: Number(row.cachedRating || 0) - Number(row.historyRating || 0),
      })),
      drift: ratingDrift.drift,
      policy: RATING_POLICY,
    });
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
    (reged && status > 0) ||
    (await canManageContest(req, cid)) ||
    ((contest.isPublic || reged) && contest.done);
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
  const isManager = await canManageContest(req, cid);
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
  const manager = await canManageContest(req, cid);
  const ctx = { cid, contest: v.contest, manager };
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

  const list = await db.query(
    `SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.codeLength,s.submitTime,s.machine,s.lang,u.name,p.title
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
  const manager = await canManageContest(req, cid);
  const ctx = { cid, contest: v.contest, manager };
  for (const r of list) await formatContestSubmissionRow(r, ctx);
  return ok(res, { data: list, total: Number(cnt && cnt.cnt || 0) });
});

// Same shape as judge.js#loadSubmissionInfo, used by both the POST
// getSubmissionInfo handler and the SSE streamSubmissionInfo bridge.
const loadContestSubmissionInfo = async (req, sid) => {
  const row = await db.one(
    'SELECT s.sid,s.uid,s.cid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.code,s.codeLength,s.submitTime,s.compileResult,s.caseResult,s.machine,s.lang,u.name,p.title,p.judgeProfile AS problemJudgeProfile ' +
    'FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid WHERE sid=?',
    [sid]
  );
  if (!row) return { status: 202, message: 'error' };

  const contest = await getContest(row.cid);
  if (!contest) return { status: 202, message: '无此比赛' };
  contest.status = contestStatus(contest);
  const reged = await isReg(req.session.uid, row.cid);
  const isManager = await canManageContest(req, row.cid);
  // Contest submissions: only the contest manager or submission.rejudge.any
  // can rejudge. submission.rejudge.self is non-contest only.
  row.canRejudge = isManager || req.can('submission.rejudge.any');
  // Visibility for contest submissions follows the contest's own rules:
  // contest done (public/registered), own submission, contest manager, or
  // the global submission.view.any. submission.view.notcontest does NOT
  // unlock contest-internal submissions by design.
  const allowed =
    (contest.status === 3 && (contest.isPublic || reged)) ||
    req.session.uid === row.uid ||
    isManager ||
    req.can('submission.view.any');
  if (!allowed) return { status: 403 };
  row.judgeProfileSummary = summarizeJudgeProfile(row.problemJudgeProfile);
  delete row.problemJudgeProfile;

  row.caseResult = row.caseResult ? JSON.parse(row.caseResult) : null;
  row.singleCaseResult = await db.query('SELECT * FROM submissionDetail WHERE sid=?', [sid]);
  row.singleCaseResult.sort((a, b) => a.caseId - b.caseId);
  row.done = false;

  // fullView reveals testdata I/O and judge details. For contests in progress
  // it's restricted to the manager and the global submission.view.any holder;
  // once the contest ends it's open. submission.view.notcontest is irrelevant
  // here — by definition this is a contest submission.
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
  if (fullView) {
    row.judgeLog = await readJudgeLogEntries(sid);
    row.judgeLogRestricted = false;
  } else {
    row.judgeLog = [];
    row.judgeLogRestricted = true;
  }
  // OI 赛制比赛中：非管理员选手只能看到提交时间，不能看到结果
  if (!contest.type && !contest.done && !isManager) {
    row.caseResult = row.singleCaseResult = row.subtaskInfo = null;
    row.score = row.judgeResult = row.time = row.memory = 0;
    row.unShown = true;
    row.judgeLog = [];
    row.judgeLogRestricted = true;
  }
  row.idx = await getIdxByPid(row.cid, row.pid);
  delete row.pid;
  formatSubmissionRow(row);
  return { data: row };
};

exports.getSubmissionLog = handler(async (req, res) => {
  const sid = parseInt(req.body.sid, 10);
  if (!sid) return fail(res, 'bad sid');

  const row = await db.one('SELECT sid,uid,cid FROM submission WHERE sid=?', [sid]);
  if (!row) return fail(res, 'error');

  const contest = await getContest(row.cid);
  if (!contest) return fail(res, '无此比赛');
  contest.status = contestStatus(contest);

  const reged = await isReg(req.session.uid, row.cid);
  const isManager = await canManageContest(req, row.cid);
  const allowed =
    (contest.status === 3 && (contest.isPublic || reged)) ||
    req.session.uid === row.uid ||
    isManager ||
    req.can('submission.view.any');
  if (!allowed) return res.status(403).end('403 Forbidden');

  const fullView = isManager || req.can('submission.view.any') || contest.status === 3;
  if (!fullView) {
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

exports.getRank = handler(async (req, res) => {
  await ensureContestRatingSchema();
  const { cid } = req.body;
  const contest = await getContest(cid);
  if (!contest) return fail(res, '无此比赛');
  const reged = await isReg(req.session.uid, cid);
  const status = contestStatus(contest);

  const allowed =
    (status === 3 && (contest.isPublic || reged)) ||
    (reged && contest.type === 1 && status > 0) ||
    (await canManageContest(req, cid));
  if (!allowed) return res.status(403).end('403 Forbidden');

  const [result, ratingStatus] = await Promise.all([
    buildContestRank(cid),
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

exports.getRatingChanges = handler(async (req, res) => {
  await ensureContestRatingSchema();
  const { cid } = req.body;
  const limit = ratingPreviewDetailLimit(req);
  const offset = Math.max(0, parseInt(req.body.offset || req.body.skip || 0, 10) || 0);
  const contest = await getContest(cid);
  if (!contest) return fail(res, '无此比赛');
  const reged = await isReg(req.session.uid, cid);
  const status = contestStatus(contest);
  const allowed =
    (status === 3 && (contest.isPublic || reged)) ||
    (await canManageContest(req, cid));
  if (!allowed) return res.status(403).end('403 Forbidden');
  const ratingStatus = await contestRatingStatusForContest(contest, status);
  const ratingMeta = ratingStatusResponseMeta(ratingStatus);
  if (!contest.ratingEnabled || !contest.done) {
    return ok(res, {
      data: [],
      ...ratingMeta,
      offset,
      limit,
      totalCount: 0,
      returnedCount: 0,
      omittedCount: 0,
      hasMoreChanges: false,
      unrated: !contest.ratingEnabled || ratingMeta.unrated,
      unsettled: (!!contest.ratingEnabled && !contest.done) || ratingMeta.unsettled,
    });
  }
  const totalCount = Number(ratingMeta.ratingRowCount || 0);
  const rating = await ratingRowsForContest(cid, { offset, limit });
  const nextOffset = offset + rating.length;
  return ok(res, {
    data: rating,
    ...ratingMeta,
    offset,
    limit,
    totalCount,
    returnedCount: nextOffset,
    omittedCount: Math.max(0, totalCount - nextOffset),
    hasMoreChanges: totalCount > nextOffset,
  });
});

exports.getUserRatingHistory = handler(async (req, res) => {
  await ensureContestRatingSchema();
  const uid = parseInt(req.body.uid || req.body.userId, 10);
  const username = String(req.body.username || '').trim();
  const user = uid
    ? await db.one('SELECT uid,name,rating FROM userInfo WHERE uid=? LIMIT 1', [uid])
    : await db.one('SELECT uid,name,rating FROM userInfo WHERE name=? LIMIT 1', [username]);
  if (!user) return ok(res, { data: [], user: null });
  const limit = Math.max(1, Math.min(parseInt(req.body.limit || req.body.takeCount || 20, 10) || 20, 100));
  const offset = Math.max(0, parseInt(req.body.offset || req.body.skip || 0, 10) || 0);
  const [rows, total] = await Promise.all([
    db.query(
      `SELECT cr.cid,cr.uid,
              ${pickedRatingValue('cr.rank')} AS rank,
              ${pickedRatingValue('cr.totalScore')} AS totalScore,
              ${pickedRatingValue('cr.usedTime')} AS usedTime,
              ${pickedRatingValue('cr.oldRating')} AS oldRating,
              ${pickedRatingValue('cr.newRating')} AS newRating,
              ${pickedRatingValue('cr.delta')} AS delta,
              ${pickedRatingText('cr.algorithm')} AS algorithm,
              MAX(cr.updateTime) AS updateTime,
              c.title,c.start
         FROM contestRating cr INNER JOIN contest c ON c.cid=cr.cid
         INNER JOIN userInfo ru ON ru.uid=cr.uid
        WHERE cr.uid=? AND c.done=1 AND c.ratingEnabled=1
        GROUP BY cr.cid,cr.uid,c.title,c.start
        ORDER BY c.start DESC,c.cid DESC
        LIMIT ?,?`,
      [user.uid, offset, limit]
    ),
    db.one(
      `SELECT COUNT(DISTINCT cr.cid) AS cnt
         FROM contestRating cr INNER JOIN contest c ON c.cid=cr.cid
         INNER JOIN userInfo ru ON ru.uid=cr.uid
        WHERE cr.uid=? AND c.done=1 AND c.ratingEnabled=1`,
      [user.uid]
    ),
  ]);
  const latest = await db.one(
    `SELECT latest.newRating
       FROM (${latestActiveRatingRowsSql}) latest
      WHERE latest.uid=?
      LIMIT 1`,
    [user.uid]
  );
  const historyRating = latest ? Number(latest.newRating || 0) : 0;
  const cachedRating = Number(user.rating || 0);
  return ok(res, {
    user: {
      uid: user.uid,
      name: user.name,
      rating: cachedRating,
      historyRating,
      ratingCacheMismatch: cachedRating !== historyRating,
      historyCount: Number(total && total.cnt || 0),
      historyOffset: offset,
      historyReturnedCount: offset + rows.length,
      historyHasMore: Number(total && total.cnt || 0) > offset + rows.length,
    },
    data: rows.map((row) => ({
      cid: row.cid,
      title: row.title,
      start: Format(row.start),
      rank: Number(row.rank),
      totalScore: Number(row.totalScore),
      usedTime: Number(row.usedTime),
      oldRating: Number(row.oldRating),
      newRating: Number(row.newRating),
	      delta: Number(row.delta),
	      algorithm: row.algorithm,
	      updateTime: Format(row.updateTime instanceof Date ? row.updateTime : new Date(row.updateTime)),
	    })),
	  });
	});

exports.getSingleUserLastSubmission = handler(async (req, res) => {
  const { cid, uid } = req.body;
  const v = await loadContestForView(req, cid);
  if (!v) return fail(res, '无此比赛');
  if (!v.canView) return res.status(403).end('403 Forbidden');

  const list = await db.query(
    `SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.codeLength,s.submitTime,s.machine,s.lang,u.name,p.title
       FROM contestLastSubmission cls
       INNER JOIN submission s ON s.sid=cls.sid AND s.cid=cls.cid AND s.uid=cls.uid AND s.pid=cls.pid
       INNER JOIN userInfo u ON u.uid=s.uid
       INNER JOIN problem p ON p.pid=s.pid
      WHERE cls.cid=? AND cls.uid=?
      ORDER BY s.sid DESC`,
    [cid, uid]
  );
  if (!list.length) return ok(res, { data: [], total: 0 });
  const manager = await canManageContest(req, cid);
  const ctx = { cid, contest: v.contest, manager };
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
  const isManager = await canManageContest(req, cid);
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
