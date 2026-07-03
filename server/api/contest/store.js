const db = require('../../db');

// Plain data access for contest endpoints. No authorization decisions here —
// that's policy.js. Kept verbatim from the pre-split contest.js.

const getContest = (cid) => db.one('SELECT * FROM contest WHERE cid=?', [cid]);

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

const getContestProblems = (cid) =>
  db.query('SELECT pid,idx,weight FROM contestProblem WHERE cid=?', [cid]);

// Contest ids the viewer holds a scoped contest.manage.any grant for.
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

// WHERE clause limiting the contest list to what the viewer may see:
// public contests, own contests, registered contests, scoped-managed contests.
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

module.exports = {
  getContest,
  isReg,
  playerCnt,
  getProblemByIdx,
  getIdxByPid,
  getContestProblems,
  scopedContestIds,
  contestListVisibility,
};
