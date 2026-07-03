const db = require('../../db');
const { handler, fail, ok } = require('../../db/util');
const { requirePermission } = require('../../auth/middleware');
const { Format } = require('../../static');
const {
  ensureContestRatingStorageSchema,
  ensureContestRatingPrimaryKey,
  ensureContestRatingAuxiliaryIndexes,
  contestRatingUniqueConstraintStatus,
  contestRatingAuxiliaryIndexStatus,
  latestActiveRatingRowsSql,
} = require('./ratingStorage');
const { getContest, isReg } = require('./store');
const { contestStatus, canManageContest } = require('./policy');
const { buildContestRank } = require('./standings');

// ============================================================================
// 比赛 Rating 全量逻辑（elo-rank-v1）：结算 / 重算 / 全量重建 / 去重 / 缓存同步 /
// 漂移审计 / 管理统计。从 contest.js 原样搬出（行为零变化），contest.js 只保留
// 比赛本体端点并从这里 require 结算与状态展示所需的少数函数。
// ============================================================================

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
const canManageRatingSystem = (req) => !!(req.can && req.can('user.role.admin'));

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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// 组队场强制不产生 rating：rating 是个人维度，组队榜单行的 user.uid 是 teamId，
// 绝不能流入 contestRating。所有结算/重建/预览路径都经过本函数。
const isTeamContest = async (cid) => {
  const contest = await getContest(cid);
  if (!contest) return false;
  const cfg = require('./formats').resolveConfig(contest);
  return !!(cfg.team && cfg.team.enabled);
};

const calculateContestRatingChanges = async (cid, baseRatings = null, options = {}) => {
  if (await isTeamContest(cid)) return [];
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

// ---- 端点（原 contest.js 导出名保持不变，router 侧仅换 require 来源）----

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

// ---- 供 contest.js 使用的内部函数 ----
module.exports.ensureContestRatingSchema = ensureContestRatingSchema;
module.exports.attachContestRatingStatus = attachContestRatingStatus;
module.exports.contestRatingStatusForContest = contestRatingStatusForContest;
module.exports.ratingStatusResponseMeta = ratingStatusResponseMeta;
module.exports.ratingRowsForContest = ratingRowsForContest;
module.exports.applyContestRating = applyContestRating;
module.exports.ratingWriteResultPayload = ratingWriteResultPayload;
