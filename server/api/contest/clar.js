// 赛内提问（Clarification）。选手提问 -> 管理员私回 / 公开回复 / 主动公告；
// 通知经 notification.push。鉴权走 policy.resolveView 的 isReged / isManager / status。
const db = require('../../db');
const { handler, fail, ok } = require('../../db/util');
const { loadView } = require('./policy');
const notification = require('../content/notification');

let ready = null;
const ensureSchema = () => {
  if (!ready) {
    ready = db.query(`
      CREATE TABLE IF NOT EXISTS contestClar (
        clarId     INT AUTO_INCREMENT PRIMARY KEY,
        cid        INT NOT NULL,
        uid        INT NOT NULL,
        pid        INT NULL,
        question   TEXT NOT NULL,
        answer     TEXT NULL,
        answeredBy INT NULL,
        isPublic   TINYINT NOT NULL DEFAULT 0,
        createdAt  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        answeredAt DATETIME NULL,
        KEY idx_cid (cid, clarId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `).catch((e) => { ready = null; throw e; });
  }
  return ready;
};

const uidOf = (req) => (req.session && req.session.uid) || 0;
const cidOf = (req) => parseInt(req.body.cid, 10) || 0;

// 报名者 uid（通知用）
const enrolledUids = async (cid) => {
  const rows = await db.query('SELECT DISTINCT uid FROM contestPlayer WHERE cid=?', [cid]);
  return rows.map((r) => r.uid);
};

// 选手提问：参赛 + 比赛进行中
exports.submitClar = handler(async (req, res) => {
  await ensureSchema();
  const uid = uidOf(req);
  if (!uid) return fail(res, '请先登录');
  const cid = cidOf(req);
  const v = await loadView(req, cid);
  if (!v) return fail(res, '比赛不存在');
  if (v.virtual) return fail(res, '虚拟参赛不支持赛内提问', 403);
  if (!v.isReged) return fail(res, '仅参赛者可提问', 403);
  if (v.status !== 1) return fail(res, '仅比赛进行中可提问');

  const question = String(req.body.question || '').trim();
  if (!question || question.length > 2000) return fail(res, '提问长度需在 1 到 2000 字之间');
  const pid = req.body.pid ? parseInt(req.body.pid, 10) : null;

  const r = await db.query(
    'INSERT INTO contestClar (cid,uid,pid,question,isPublic) VALUES (?,?,?,?,0)',
    [cid, uid, pid, question]
  );
  // 通知比赛创建者（管理员侧红点）
  if (v.contest.host && v.contest.host !== uid) {
    notification.push(v.contest.host, {
      type: 'clar_new', refType: 'contest', refId: cid,
      title: `比赛「${v.contest.title}」有新提问`,
      content: question.slice(0, 120), link: `/contest/${cid}`, excludeUid: uid,
    }).catch(() => {});
  }
  return ok(res, { clarId: r.insertId });
});

// 列表：选手 = 自己的提问 + 公开条目；管理 = 全部
exports.listClars = handler(async (req, res) => {
  await ensureSchema();
  const uid = uidOf(req);
  const cid = cidOf(req);
  const v = await loadView(req, cid);
  if (!v) return fail(res, '比赛不存在');
  if (!v.caps.canEnter) return fail(res, '无权限查看', 403);

  let rows;
  if (v.isManager) {
    rows = await db.query(
      'SELECT c.clarId,c.uid,c.pid,c.question,c.answer,c.answeredBy,c.isPublic,c.createdAt,c.answeredAt,u.name AS askerName ' +
      'FROM contestClar c LEFT JOIN userInfo u ON u.uid=c.uid WHERE c.cid=? ORDER BY c.clarId DESC',
      [cid]
    );
  } else {
    rows = await db.query(
      'SELECT clarId,uid,pid,question,answer,answeredBy,isPublic,createdAt,answeredAt ' +
      'FROM contestClar WHERE cid=? AND (isPublic=1 OR uid=?) ORDER BY clarId DESC',
      [cid, uid]
    );
  }
  return ok(res, { data: rows, isManager: v.isManager });
});

// 管理员回复（私回 / 公开）
exports.answerClar = handler(async (req, res) => {
  await ensureSchema();
  const uid = uidOf(req);
  if (!uid) return fail(res, '请先登录');
  const clarId = parseInt(req.body.clarId, 10) || 0;
  const clar = await db.one('SELECT * FROM contestClar WHERE clarId=?', [clarId]);
  if (!clar) return fail(res, '提问不存在');
  const v = await loadView(req, clar.cid);
  if (!v || !v.isManager) return fail(res, '无权限', 403);

  const answer = String(req.body.answer || '').trim();
  if (!answer || answer.length > 4000) return fail(res, '回复长度需在 1 到 4000 字之间');
  const isPublic = req.body.isPublic ? 1 : 0;

  await db.query(
    'UPDATE contestClar SET answer=?,answeredBy=?,answeredAt=NOW(),isPublic=? WHERE clarId=?',
    [answer, uid, isPublic, clarId]
  );
  // 通知：公开 -> 全体参赛者；私回 -> 仅提问者
  if (isPublic) {
    const uids = await enrolledUids(clar.cid);
    notification.push(uids, {
      type: 'clar_public', refType: 'contest', refId: clar.cid,
      dedupeKey: `clar_public:${clarId}`,
      title: `比赛「${v.contest.title}」发布了公开答复`,
      content: answer.slice(0, 120), link: `/contest/${clar.cid}`, excludeUid: uid,
    }).catch(() => {});
  } else if (clar.uid && clar.uid !== uid) {
    notification.push(clar.uid, {
      type: 'clar_reply', refType: 'contest', refId: clar.cid,
      title: '你的提问收到了答复',
      content: answer.slice(0, 120), link: `/contest/${clar.cid}`, excludeUid: uid,
    }).catch(() => {});
  }
  return ok(res);
});

// 管理员主动发全场公告
exports.postAnnouncement = handler(async (req, res) => {
  await ensureSchema();
  const uid = uidOf(req);
  if (!uid) return fail(res, '请先登录');
  const cid = cidOf(req);
  const v = await loadView(req, cid);
  if (!v || !v.isManager) return fail(res, '无权限', 403);

  const content = String(req.body.content || '').trim();
  if (!content || content.length > 4000) return fail(res, '公告长度需在 1 到 4000 字之间');

  const r = await db.query(
    "INSERT INTO contestClar (cid,uid,pid,question,answer,answeredBy,isPublic,answeredAt) VALUES (?,?,NULL,'',?,?,1,NOW())",
    [cid, uid, content, uid]
  );
  const uids = await enrolledUids(cid);
  notification.push(uids, {
    type: 'clar_public', refType: 'contest', refId: cid,
    dedupeKey: `clar_public:${r.insertId}`,
    title: `比赛「${v.contest.title}」发布了公告`,
    content: content.slice(0, 120), link: `/contest/${cid}`, excludeUid: uid,
  }).catch(() => {});
  return ok(res, { clarId: r.insertId });
});

exports.ensureSchema = ensureSchema;
