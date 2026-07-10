// 站内通知系统。push helper 供各模块调用（讨论回复 / 赛内提问 / 开赛提醒 / 广播）。
// 端点：本人拉取 / 未读数 / 标记已读 / 管理员广播。
const db = require('../../db');
const { handler, fail, ok, paginate } = require('../../db/util');

// 运行时建表（groupSchema.js 同款），无迁移也可用。
let ready = null;
const ensureSchema = () => {
  if (!ready) {
    ready = db.query(`
      CREATE TABLE IF NOT EXISTS notification (
        nid       INT AUTO_INCREMENT PRIMARY KEY,
        uid       INT NOT NULL,
        type      VARCHAR(32) NOT NULL,
        refType   VARCHAR(16) NULL,
        refId     INT NULL,
        dedupeKey VARCHAR(64) NULL,
        title     VARCHAR(255) NOT NULL,
        content   TEXT NULL,
        link      VARCHAR(255) NULL,
        isRead    TINYINT NOT NULL DEFAULT 0,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_uid_dedupe (uid, dedupeKey),
        KEY idx_uid_read (uid, isRead, nid)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `).catch((e) => { ready = null; throw e; });
  }
  return ready;
};

const uidOf = (req) => (req.session && req.session.uid) || 0;

// ---- push helper（模块导出，绝不抛错影响主流程）----
// uids: number | number[]；excludeUid: 触发者（不通知自己）
// dedupeKey 撞 UNIQUE(uid,dedupeKey) 即静默跳过（幂等）。
const push = async (uids, { type, refType = null, refId = null, dedupeKey = null, title, content = null, link = null, excludeUid = null }) => {
  try {
    await ensureSchema();
    let list = Array.isArray(uids) ? uids : [uids];
    list = [...new Set(list.map(Number).filter((u) => u > 0 && u !== Number(excludeUid)))];
    if (!list.length || !type || !title) return 0;
    // dedupeKey 为空时用 NULL（UNIQUE 允许多个 NULL），逐行 INSERT IGNORE。
    const rows = list.map((uid) => [uid, type, refType, refId, dedupeKey, String(title).slice(0, 255), content, link]);
    const r = await db.query(
      'INSERT IGNORE INTO notification (uid,type,refType,refId,dedupeKey,title,content,link) VALUES ?',
      [rows]
    );
    return r.affectedRows || 0;
  } catch (e) {
    console.log('notification push error:', e && e.message);
    return 0;
  }
};

// 全站广播：写给全部用户，分批 INSERT，避免单条超大 values。
const broadcastToAll = async ({ type = 'broadcast', title, content = null, link = null, dedupeKey = null }) => {
  await ensureSchema();
  const users = await db.query('SELECT uid FROM userInfo');
  const CHUNK = 1000;
  let total = 0;
  for (let i = 0; i < users.length; i += CHUNK) {
    total += await push(users.slice(i, i + CHUNK).map((u) => u.uid), { type, title, content, link, dedupeKey });
  }
  return total;
};

// ---- 端点 ----

exports.getNotifications = handler(async (req, res) => {
  const uid = uidOf(req);
  if (!uid) return fail(res, '请先登录');
  await ensureSchema();
  const { limit, offset, pageId } = paginate(req, 20);
  const [rows, cnt, unread] = await Promise.all([
    db.query('SELECT nid,type,refType,refId,title,content,link,isRead,createdAt FROM notification WHERE uid=? ORDER BY nid DESC LIMIT ? OFFSET ?', [uid, limit, offset]),
    db.one('SELECT COUNT(*) AS c FROM notification WHERE uid=?', [uid]),
    db.one('SELECT COUNT(*) AS c FROM notification WHERE uid=? AND isRead=0', [uid]),
  ]);
  return ok(res, { data: rows, total: cnt.c, unread: unread.c, pageId });
});

exports.getUnreadCount = handler(async (req, res) => {
  const uid = uidOf(req);
  if (!uid) return fail(res, '请先登录');
  await ensureSchema();
  const unread = await db.one('SELECT COUNT(*) AS c FROM notification WHERE uid=? AND isRead=0', [uid]);
  return ok(res, { unread: unread.c });
});

exports.markRead = handler(async (req, res) => {
  const uid = uidOf(req);
  if (!uid) return fail(res, '请先登录');
  await ensureSchema();
  const nids = Array.isArray(req.body.nids) ? req.body.nids.map(Number).filter((n) => n > 0) : [];
  if (!nids.length) return fail(res, '缺少通知 ID');
  await db.query('UPDATE notification SET isRead=1 WHERE uid=? AND nid IN (?)', [uid, nids]);
  return ok(res);
});

exports.markAllRead = handler(async (req, res) => {
  const uid = uidOf(req);
  if (!uid) return fail(res, '请先登录');
  await ensureSchema();
  await db.query('UPDATE notification SET isRead=1 WHERE uid=? AND isRead=0', [uid]);
  return ok(res);
});

exports.broadcast = handler(async (req, res) => {
  const uid = uidOf(req);
  if (!uid) return fail(res, '请先登录');
  if (!req.can('user.manage')) return fail(res, '无权限广播', 403);
  const title = String(req.body.title || '').trim();
  if (!title || title.length > 255) return fail(res, '标题长度需在 1 到 255 字之间');
  const content = req.body.content ? String(req.body.content).slice(0, 4000) : null;
  const link = req.body.link ? String(req.body.link).slice(0, 255) : null;
  const n = await broadcastToAll({ title, content, link });
  return ok(res, { sent: n });
});

exports.ensureSchema = ensureSchema;
exports.push = push;
exports.broadcastToAll = broadcastToAll;
